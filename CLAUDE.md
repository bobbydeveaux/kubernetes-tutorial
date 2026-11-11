# CLAUDE.md

Guidance for Claude Code when working in this repository. `README.md` is the
full reference (what each file is, the step format, troubleshooting); read it
before making changes. This file covers what matters when *changing* things.

## What this is

A live demo for a beginner-level "how to use Kubernetes" conference talk.
A local web UI (`http://localhost:7777`) steps through a script; each press of
Enter types a command into an on-screen terminal and runs it for real against
a 4-node k3d cluster on the presenter's Mac. A live cluster map and traffic
panel sit beside it. The presenter also drops to a real terminal against the
same cluster.

The audience is new to Kubernetes. The presenter is an experienced engineer.

## Principles (these have driven every decision so far)

1. **Real, not simulated.** Every command shown is exactly the command run.
   Never fake output, never hide a second command behind the one displayed,
   never show a prettier command than the one that executes.
2. **Beat the demo gods.** Fewer moving parts wins. No npm dependencies, no
   build step, no registry, no DNS tricks. Every step must be safe to run
   twice. If a feature adds a way to fail on stage, it needs to earn it.
3. **Teaching clarity over completeness.** Manifests in `k8s/` are read aloud
   to beginners. Keep them minimal; every extra line has to be explained on
   stage. Prefer cluster-level config (in `cluster/k3d.yaml`) over cluttering
   the manifests when something is only needed to make the demo behave.
4. **Honest narration.** If the demo is tuned (see failure-detection flags),
   the talking point says so. If something costs errors (host loss), show the
   errors rather than hiding them.
5. **Never touch the presenter's other clusters.** See Safety below. This is
   not negotiable.

## Commands

```bash
./demo.sh check     # tools present, engine running, port 8080 free
./demo.sh prep      # build images, create+delete a cluster to warm caches
./demo.sh reset     # delete the demo cluster and empty .kube/config
./demo.sh           # run the runner in the foreground on :7777
source env.sh       # point the current shell's kubectl at the demo cluster

test/e2e.sh                  # full run through the HTTP API (destroys + recreates cluster)
node test/ui-drive.js live   # headless Chrome key presses + screenshots to test/shots/
node --check demo/server.js && node --check demo/steps.js   # quick syntax check
```

To syntax-check the inline script in the UI:

```bash
sed -n '/<script>/,/<\/script>/p' demo/index.html | sed '1d;$d' > /tmp/ui.js && node --check /tmp/ui.js
```

## Architecture in one screen

- `demo/steps.js`: data only. An array of steps; the UI and server read
  everything from it. Re-read on every request (no restart needed).
- `demo/server.js`: Node stdlib HTTP server on 127.0.0.1:7777.
  - `GET /api/steps`: steps plus the text of each referenced file.
  - `POST /api/run {step, index, params}` or `{action, params}`: resolves to a
    command string **server-side** from `steps.js` / `ACTIONS`, runs it with
    `bash -c` in the repo root, streams NDJSON (`{t:'out'|'exit'}`). One
    command at a time (409 otherwise).
  - `GET /api/events`: server-sent events with the compact cluster state
    (`readState()`), re-sent only when it changes. Polls every 700 ms.
  - `GET /api/hit`: one request to `127.0.0.1:8080/api`, 1.5 s timeout.
  - `POST /api/stop`: SIGINT the running command.
- `demo/index.html`: single-file UI, no framework. Key pieces: `resolvers`
  (fill `{pod}`/`{node}` from state), `renderCmds`, `execute` (typing
  animation then streaming), `renderCluster` (keyed pod elements so they
  animate rather than re-render), `T` / `hitOnce` (traffic).
- `cluster/k3d.yaml`: cluster `talk`, 1 server + 3 agents, API and port 8080
  bound to 127.0.0.1, control plane tainted, failure detection shortened.
- `k8s/*.yaml`: namespace `demo`, Deployment/Service/Ingress all named `whoami`.
- `app/`: Go `whoami` service. `hue()` in `main.go` and `hue` in
  `index.html` are the **same hash and must stay identical**, so a pod has
  the same colour on its own page and in the map. Range is 165 to 295
  (teal to purple) on purpose: red, amber and green mean status.

## Safety rules

- All kubectl access goes through `KUBECONFIG=<repo>/.kube/config`. The runner
  sets it in `ENV`; `demo.sh` and `env.sh` export it. Any new script or test
  **must** do the same. Never run bare `kubectl` relying on the default
  context: on the original machine `~/.kube/config` held production EKS and
  GKE contexts.
- Do not use or modify OrbStack's built-in Kubernetes. On the original machine
  it was running real workloads (an `agentops` namespace). The demo cluster is
  always k3d cluster `talk`. For experiments, create a *second* k3d cluster
  with a different name, port and kubeconfig file, and delete it afterwards.
- The browser must never be able to send an arbitrary command. Keep
  `resolveCommand` as the only path to `run()`, keep `SAFE_PARAM`, and keep
  the `k3d-talk-` prefix check on `node` params (it guards `docker stop`).
- Keep the Host and Origin checks at the top of the request handler.
- Keep everything bound to 127.0.0.1 (runner, ingress port, API port). The
  demo runs on conference wifi.
- `.kube/` holds admin credentials for the demo cluster. It is gitignored;
  keep it that way.

## How to change things

**Wording, order, commands, notes**: edit `demo/steps.js` only. After changing
a manifest or source file, check that each `notes[].match` string for that
file still occurs in it; a miss fails silently (no highlight).

**A new step**: add an object to `steps.js`. Use `optional: true` for commands
the presenter may skip and `confirm: true` for destructive ones. If it needs a
live target, add a resolver in `index.html` (`resolvers`) and reference it via
`params`. Then run it for real, including pressing Enter through it in the UI.

**A new field in cluster state**: add it in `readState()` in `server.js`, use
it in `renderCluster()` in `index.html`. Keep the state object small; it is
re-sent whenever it changes.

**Cluster behaviour**: `cluster/k3d.yaml`. Any change means existing clusters
are stale: `./demo.sh reset` and recreate before testing.

**The app**: after changing `app/`, images must be rebuilt and re-imported
(steps 5 and 12 do this; so does `./demo.sh prep`).

## Testing expectations

Syntax checks are not enough for this project. A change is not done until it
has been exercised against a real cluster, because the failure this repo
exists to prevent is "it broke on stage".

- Behaviour change: run `test/e2e.sh` and read the output. Every command
  should end `-> exit 0`; `HITS` blocks should be evenly split with
  `errors 0` through the pod kill, the rollout and the drain.
- UI change: run `node test/ui-drive.js live` and look at the screenshots in
  `test/shots/`, or ask the presenter for a screenshot. Check 1600x950 and
  1280x720, and both themes if colours changed.
- Anything touching step 14 (host loss), scheduling, or `cluster/k3d.yaml`:
  test on a scratch cluster under load and record the timeline (when the node
  went NotReady, when pods were replaced, how many requests failed). The
  baseline measured with the current flags: node NotReady about 20 s after
  `docker stop`, pods replaced by about 45 s, roughly 30 to 40 failed requests
  at 5 requests/second with 3 of 9 pods on the dead node, zero errors after.
- If you could not test something, say so explicitly in your summary and in
  the README's verification table. Do not describe untested behaviour as
  working.

Both test scripts were moved into `test/` from a scratch directory with only
path changes and have not been re-run from there. Expect to fix small things
the first time. `test/e2e.sh` does not cover step 14.

## Environment notes

- Headless Chrome with `--screenshot` hangs on the UI (the event stream never
  goes idle). Use `test/ui-drive.js`, which drives Chrome over DevTools.
- Inside the Claude Code sandbox on macOS, connections to 127.0.0.1 are
  blocked, so `kubectl`, `curl localhost` and starting the runner fail with
  "operation not permitted". Docker and k3d commands work. Put multi-command
  test runs in a script file and run that outside the sandbox, with
  `KUBECONFIG` pinned inside the script.
- `docker build` in the sandbox needs `BUILDX_CONFIG` pointed at a writable
  temp directory, and network access to Docker Hub for the base image.
- If the presenter is using the cluster while you work, do not run tests
  against it. Use a scratch cluster.

## Current state and open work

Working and verified: steps 1 to 14, see the table in `README.md` under
Testing.

Open, in priority order:

1. **Rebalancing after uncordon (step 13).** The optional
   `kubectl rollout restart deployment/whoami -n demo` has a note claiming it
   spreads pods back out. The presenter reported it did not. Not reproduced:
   the cluster was torn down mid-test. Plan:
   - First measure: with 3 pods all on one node, run `rollout restart` three
     times and record pods per node each time.
   - Likely fix: `topologySpreadConstraints` in `k8s/deployment.yaml`
     (`maxSkew: 1`, `topologyKey: kubernetes.io/hostname`,
     `labelSelector` `app: whoami`). Start with
     `whenUnsatisfiable: ScheduleAnyway`.
   - Risk to test before keeping it: with `DoNotSchedule`, a cordoned or
     NotReady node still counts as an empty domain unless
     `nodeTaintsPolicy: Honor` is set, so replacement pods can sit Pending and
     break steps 13 and 14. Also old and new ReplicaSet pods both match the
     selector during a rollout (`matchLabelKeys: [pod-template-hash]`
     addresses that on newer Kubernetes).
   - Add a manifest note for the new block and fix the step 13 note to match
     whatever is actually true.
2. **Unverified UI changes.** "A command that has run keeps showing the exact
   text it ran" (`ran` in `index.html`) and the single "N gone" row in the
   traffic list. Both parse; neither has been seen in a browser.
3. **Re-run both test scripts** from `test/` on the new machine and fix any
   path fallout. Consider adding step 14 to `test/e2e.sh`.
4. **Newer k3d / Kubernetes.** k3d v5.6.0 pins v1.27.5. After upgrading,
   confirm the three timing flags in `cluster/k3d.yaml` are still accepted
   and step 14 still takes about 30 seconds.

Ideas the presenter liked but that are not built: audience traffic via QR
code, a deliberately broken v3 to show a stalled rollout and `rollout undo`,
an autoscaler driven by the traffic panel.

## Style

- Plain JavaScript, no dependencies, no build step, no TypeScript. One HTML
  file for the UI. Keep it that way unless asked.
- UI sizes in `rem` so the zoom keys work. Colours through the CSS variables
  at the top of `index.html`; both themes must work.
- Text shown to the audience is short, concrete and free of jargon the slides
  have not introduced. British spelling.
