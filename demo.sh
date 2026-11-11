#!/usr/bin/env bash
# ./demo.sh          start the demo UI (http://localhost:7777)
# ./demo.sh prep     dress-rehearse the slow parts so images and build layers are cached
# ./demo.sh reset    back to "no cluster" (run before you go on stage)
# ./demo.sh check    is this laptop ready?
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .kube
export KUBECONFIG="$PWD/.kube/config"

reset() {
  k3d cluster delete talk 2>/dev/null || true
  : > "$KUBECONFIG"
  echo "Clean: no demo cluster."
}

case "${1:-start}" in
  start)
    exec node demo/server.js
    ;;
  check)
    for tool in docker k3d kubectl node curl; do
      command -v "$tool" >/dev/null && echo "ok    $tool" || echo "MISSING  $tool"
    done
    docker info >/dev/null 2>&1 && echo "ok    docker engine is running" || echo "DOWN  docker engine (start OrbStack)"
    if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 && ! k3d cluster list 2>/dev/null | grep -q '^talk'; then
      echo "BUSY  port 8080 is in use by something else"
    else
      echo "ok    port 8080"
    fi
    ;;
  prep)
    # A full dress rehearsal of the slow parts, then tear down. Leaves the
    # node images and build layers cached in OrbStack. Note: the cluster still
    # pulls its own system images (ingress controller, DNS) each time it is
    # created, so creating it live needs a network connection.
    reset
    docker build -t whoami:v1 app/
    docker build --build-arg VERSION=v2 -t whoami:v2 app/
    k3d cluster create --config cluster/k3d.yaml
    k3d image import whoami:v1 whoami:v2 -c talk
    echo "Waiting for the ingress controller..."
    until kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik 2>/dev/null | grep -q Running; do sleep 2; done
    reset
    echo "Caches are warm. Run ./demo.sh"
    ;;
  reset)
    reset
    ;;
  *)
    sed -n '2,5p' "$0"
    ;;
esac
