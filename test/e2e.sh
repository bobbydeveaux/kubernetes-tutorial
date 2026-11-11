#!/usr/bin/env bash
# Drives the demo runner end to end through its HTTP API, like the UI does:
# every step from an empty laptop to a drained node, with traffic running
# during the pod kill, rollout and drain. Read the output: HITS lines should
# be evenly split and show "errors 0".
#
# DESTRUCTIVE to the demo cluster only: starts with ./demo.sh reset.
# Needs ports 7777 and 8080 free (stop a running ./demo.sh first).
# Does not cover the 'hostloss' step.
set -uo pipefail
cd "$(dirname "$0")/.."
TMPDIR="${TMPDIR:-/tmp}"
B=http://127.0.0.1:7777
./demo.sh reset
node demo/server.js > "$TMPDIR/runner.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1

run() { # step index [params-json]
  local P="${3:-}"; [ -z "$P" ] && P='{}'
  echo "=== $1[$2] ${3:-}"
  curl -sN -X POST $B/api/run -H 'Content-Type: application/json' \
    -d "{\"step\":\"$1\",\"index\":$2,\"params\":$P}" |
    node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{let o="",c;for(const l of b.split("\n").filter(Boolean)){const m=JSON.parse(l);if(m.t=="out")o+=m.d;if(m.t=="exit")c=m.code;if(m.error)o+=m.error}const L=o.trimEnd().split("\n");console.log(L.slice(-(+process.argv[1]||12)).join("\n"));console.log("-> exit",c)})' "${TAIL:-12}"
}
state() { curl -sN --max-time 1 $B/api/events 2>/dev/null | head -1 | sed 's/^data: //'; }
summary() { state | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const s=JSON.parse(b);console.log("STATE cluster",s.cluster,"ns",s.ns,"dep",JSON.stringify(s.deployment),"svc",!!s.service,"ing",s.ingress);for(const p of s.pods||[])console.log("  ",p.name,p.node,p.version,p.ready?"ready":"notready",p.terminating?"TERM":"")})'; }
hits() { for i in $(seq 1 "$1"); do curl -s $B/api/hit; echo; done | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const c={};let e=0;for(const l of b.split("\n").filter(Boolean)){const m=JSON.parse(l);if(m.ok)c[m.pod+" "+m.version]=(c[m.pod+" "+m.version]||0)+1;else{e++;c["ERR "+m.error]=(c["ERR "+m.error]||0)+1}}console.log("HITS",JSON.stringify(c,null,1),"errors",e)})'; }

echo "forbidden check: $(curl -s -H 'Host: evil.example' $B/api/steps)"
echo "bad param check: $(curl -s -X POST $B/api/run -H 'Content-Type: application/json' -d '{"action":"kill","params":{"pod":"x; rm -rf /"}}')"
summary
run engine 0; run engine 1
run create 0; run create 1
grep server: .kube/config
run nodes 0
run namespaces 0; run namespaces 2; run namespaces 3
TAIL=4 run image 0; TAIL=4 run image 1
run deployment 0; sleep 12; run deployment 1; run deployment 2
run service 0; run service 1; run service 2
run ingress 0; run ingress 1; run ingress 2
run loadbalance 0
summary; hits 30

echo "##### self-heal"
POD=$(state | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>console.log(JSON.parse(b).pods[0].name))')
( hits 60 ) & HP=$!
run selfheal 0 "{\"pod\":\"$POD\"}"
wait $HP; sleep 6; run selfheal 1

echo "##### scale"
run scale 0; sleep 10; run scale 1; hits 45; run scale 2; sleep 8

echo "##### rollout under load"
TAIL=3 run rollout 0; TAIL=3 run rollout 1
( hits 220 ) & HP=$!
run rollout 2; run rollout 3
wait $HP; summary

echo "##### drain under load"
NODE=$(state | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>console.log(JSON.parse(b).pods.find(p=>p.ready).node))')
( hits 120 ) & HP=$!
run drain 0 "{\"node\":\"$NODE\"}"
run drain 1; wait $HP; sleep 5; run drain 2
run drain 3 "{\"node\":\"$NODE\"}"
summary
echo "--- runner log"; cat "$TMPDIR/runner.log"
