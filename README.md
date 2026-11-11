# Kubernetes, live

A click-through live demo for a "how to use Kubernetes" talk, aimed at people
who are new to it. It follows on from slides that explain what Kubernetes is.

You press Enter. The UI types the next command into an on-screen terminal and
runs it **for real** against a real 4-node cluster on your laptop. Beside the
terminal, a live map shows the nodes and pods changing as it happens, and a
traffic panel shows which pod answers each request. At any point you can switch
to your own terminal and poke at the same cluster by hand.

Nothing is faked or pre-recorded. The script exists so you never mistype a
command on stage, not to hide what is happening.

## Contents

- [Quick start](#quick-start)
- [Setting up a new Mac](#setting-up-a-new-mac)
- [Driving the demo](#driving-the-demo)
- [The run-of-show](#the-run-of-show)
- [How it works](#how-it-works)
- [Editing the script](#editing-the-script)
- [Before you go on stage](#before-you-go-on-stage)
- [Safety](#safety)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known gaps and ideas](#known-gaps-and-ideas)

## Quick start

```bash
./demo.sh check     # is this laptop ready?
./demo.sh reset     # back to "no cluster"
./demo.sh           # start the runner, then open http://localhost:7777
```

To use the same cluster from your own terminal:

```bash
source env.sh
kubectl get pods -n demo -o wide
```

The app itself is at <http://localhost:8080> once you reach step 8.

## Setting up a new Mac

You need a container engine, k3d, kubectl and Node. Nothing else: the runner
has no npm dependencies.

```bash
brew install --cask orbstack        # the container engine (Docker Desktop also works)
brew install k3d kubectl node
open -a OrbStack                    # start it once and let it finish setting up

git clone git@github.com:bobbydeveaux/kubernetes-tutorial.git
cd kubernetes-tutorial
./demo.sh check
./demo.sh prep                      # one-off: builds images and warms caches (needs network)
./demo.sh
```

Versions this was built and tested with: OrbStack (Docker 29.4), k3d v5.6.0
(which runs Kubernetes v1.27.5), kubectl, Node 24. Node 18 or newer is enough
for the runner. A newer k3d will give a newer Kubernetes; that should be fine
but run the whole demo once after upgrading, in particular the "Lose a host"
step, whose timing depends on flags in `cluster/k3d.yaml`.

Ports used, all bound to localhost only: **7777** (the demo UI), **8080** (the
app, through the cluster's ingress), and a random port for the Kubernetes API.

## Driving the demo

| Key | Does |
| --- | --- |
| Enter / Space | type and run the next command; when the step is done, go to the next step |
| ← → | previous / next step (without running anything) |
| L | live traffic on / off |
| + − | zoom, for the projector |
| T | light / dark theme |
| Esc | stop a running command |

On screen:

- **Left**: the steps. A tick means every required command in it has run.
- **Middle**: the talking point, the manifest being discussed, the commands,
  and the terminal. Click a note beside a manifest to highlight the lines it
  is about. Each command has a **Run** button and a **copy** button.
  Commands tagged *optional* are skipped by Enter; click Run to use them.
  Destructive commands ask "Sure?" and need a second click.
- **Right**: the request path (Laptop → Ingress → Service → Deployment, each
  lighting up when it exists), the namespaces, the cluster map, and live
  traffic.
- **Cluster map**: hover a pod and click × to delete it. Pod colours identify
  the pod (the app's own web page uses the same colour). They are always in
  the teal-to-purple range; green, amber and red are reserved for status.
- **Bottom**: commands worth typing yourself in a real terminal for that step.

The layout is designed for 1080p. On a 720p projector press − a couple of
times.

## The run-of-show

| # | Step | What the audience sees |
| --- | --- | --- |
| 1 | Start with nothing | Just a container engine. No clusters. |
| 2 | Spin up a cluster | `k3d cluster create` (about 30s), then `docker ps` reveals the "machines" are containers. |
| 3 | Meet the nodes | `kubectl get nodes`: one control plane, three workers. |
| 4 | Namespaces | `kubectl get ns`, the simplest possible manifest, `kubectl apply`. |
| 5 | Build the app | The Dockerfile and the Go service; build the image and load it onto the nodes. |
| 6 | Deployment | The Deployment manifest; three pods appear, one per worker. `kubectl get deployments`. |
| 7 | Service | One stable address; `kubectl get endpoints` shows it found the pods by label. |
| 8 | Ingress | The front door; `curl localhost:8080/api` answers from a pod. |
| 9 | Load balancing | Twelve requests, answered in turn by the three pods. Switch on live traffic and leave it on. |
| 10 | Self-healing | Delete a pod; a replacement appears; no errors. |
| 11 | Scale out | 3 → 9 pods; traffic spreads as they become ready. |
| 12 | Zero-downtime deploy | Roll out v2 under load; pods swap a few at a time; error counter stays at 0. |
| 13 | Drain a node (planned) | Pods are moved off first, no errors. Uncordon: the node stays empty, because Kubernetes never moves a running pod to even things out. |
| 14 | Lose a host (unplanned) | `docker stop` a worker under load. About 30s of errors while Kubernetes decides the node is dead, then every lost pod is replaced elsewhere. `docker start` brings it back. |
| 15 | Tear it all down | Delete the namespace; optionally the cluster. |

The contrast between 13 and 14 is deliberate: planned maintenance costs
nothing, a sudden failure costs you the time it takes to notice.

## How it works

```
browser (demo/index.html)
   │  POST /api/run {step, index}        GET /api/events (live state)     GET /api/hit
   ▼
demo/server.js  ── runs the command with bash ──►  kubectl / docker / k3d
   │                                                    │
   │  polls kubectl every 0.7s                          ▼
   └────────────────────────────────────────►  k3d cluster "talk" on OrbStack
                                                 server-0 (control plane, tainted)
                                                 agent-0, agent-1, agent-2 (workers)
                                                 serverlb: localhost:8080 → ingress
```

| Path | What it is |
| --- | --- |
| `demo/steps.js` | The run-of-show: titles, talking points, commands, manifest notes. **This is the file you edit.** |
| `demo/server.js` | The runner. Serves the UI, runs commands and streams their output, polls cluster state, proxies test requests to the app. Plain Node, no dependencies. |
| `demo/index.html` | The whole UI in one file: plain HTML, CSS and JavaScript. |
| `demo.sh` | `start` (default), `check`, `prep`, `reset`. |
| `env.sh` | `source` it to point a terminal at the demo cluster. |
| `cluster/k3d.yaml` | The cluster definition. |
| `k8s/` | `namespace.yaml`, `deployment.yaml`, `service.yaml`, `ingress.yaml`. |
| `app/` | `whoami`: a small Go web service that reports which pod answered, plus its Dockerfile. |
| `test/` | End-to-end and UI test scripts (see [Testing](#testing)). |

### The cluster

`cluster/k3d.yaml` creates a k3d cluster called `talk`: 1 server and 3 agents,
each a container. OrbStack's own built-in Kubernetes is single-node, so k3d is
what makes a multi-node demo possible; OrbStack is just the engine underneath.

- The control plane is tainted so the app only runs on the workers.
- `localhost:8080` maps to the cluster's ingress controller (Traefik, which
  ships with k3s).
- Three flags shorten failure detection so the "Lose a host" step takes about
  30 seconds instead of the default 5 minutes or so. They are commented in the
  file. Say this on stage: a real cluster is more patient by default.

### The app

`app/main.go` serves three paths: `/` (a coloured page naming the pod), `/api`
(the same as JSON) and `/healthz` (for the readiness probe). It learns its pod
name, node and IP from environment variables that the Deployment fills in
using the Downward API. On SIGTERM it keeps serving for 4 seconds before
shutting down, which is what keeps rollouts and drains error-free.

The version is baked in at build time: `docker build --build-arg VERSION=v2`.
Images are loaded straight onto the nodes with `k3d image import`; there is no
registry.

### The runner

- **It can only run commands written in `demo/steps.js`.** The browser sends a
  step id and command index, never a command string. The one exception is the
  × on a pod, which runs a fixed `kubectl delete pod` template.
- **Placeholders** such as `{pod}` and `{node}` are filled in from live cluster
  state by the browser, then validated by the server (lowercase letters,
  digits, dots and dashes only; node names must start with `k3d-talk-`).
- **Live state** comes from three `kubectl get ... -o json` calls every 0.7
  seconds, pushed to the browser over server-sent events when something
  changes.
- **Live traffic** is the browser asking the runner for `/api/hit` about 4.5
  times a second; the runner makes one fresh request to `localhost:8080/api`
  each time with a 1.5 second timeout.
- `steps.js` is re-read on every request, so text edits show up on a browser
  refresh. Changes to `server.js` need the runner restarted.

## Editing the script

Everything the audience reads is in `demo/steps.js`. A step looks like this:

```js
{
  id: 'service',                      // also the URL hash: localhost:7777/#service
  act: 'App',                         // the group heading in the left rail
  title: 'Service: one stable address',
  say: 'Pods come and go and their IPs change. ...',
  files: [
    {
      path: 'k8s/service.yaml',
      notes: [
        // match: text on the first line to highlight. span: how many lines.
        { match: 'selector:', span: 2, text: 'Same label as the Deployment. ...' },
      ],
    },
  ],
  commands: [
    { cmd: 'kubectl apply -f k8s/service.yaml' },
    { cmd: 'kubectl get endpoints -n demo', note: 'The Service found our three pods by label.' },
  ],
  cli: ['kubectl get svc,endpoints -n demo'],   // "in your own terminal" suggestions
}
```

Command options:

| Option | Meaning |
| --- | --- |
| `note` | Small explanatory line under the command. |
| `optional: true` | Skipped by Enter; run by clicking. Does not count towards the step's tick. |
| `confirm: true` | Destructive; needs a second click, and Enter will not run it. |
| `params: { pod: 'firstPod' }` | Fill `{pod}` in the command from live state. |

Available `params` sources:

| Name | Resolves to |
| --- | --- |
| `firstPod` | the oldest ready pod |
| `podNode` | the node that pod is on |
| `cordonedNode` | the node currently cordoned |
| `busyNode` | the healthy worker with the most pods, never the one hosting the ingress controller |
| `downNode` | the node currently not ready |

If you change a manifest, check the `match` strings in its notes still appear
in the file, or the highlight silently does nothing.

## Before you go on stage

1. `./demo.sh prep` once on good wifi. It builds both image versions and
   creates then deletes a cluster, so node images and build layers are cached.
2. `./demo.sh reset`, then `./demo.sh`. Open <http://localhost:7777> and leave
   it on step 1.
3. Open a second terminal, `cd` to the repo and `source env.sh`.
4. Run the whole thing once, start to finish, including step 14.
5. **Creating the cluster live needs a network connection.** Every time it is
   created, the cluster pulls its own ingress controller and DNS images, and
   those are not cached by `prep`. If the venue wifi is doubtful, run steps 1
   and 2 before the talk and open on step 3.

## Safety

- **Your other clusters are out of reach.** The runner and `env.sh` set
  `KUBECONFIG` to `.kube/config` inside this folder, which only ever contains
  the demo cluster. `~/.kube/config` is never read or changed, and the cluster
  is created without touching your current context.
- **OrbStack's built-in Kubernetes is not used**, so anything you run there is
  left alone.
- The UI, the app and the Kubernetes API all listen on localhost only, so
  nobody on the conference network can reach them.
- The runner rejects requests that are not addressed to localhost or that come
  from another website.
- `docker stop` / `docker start` in step 14 can only ever name the demo's own
  node containers.
- `.kube/` is in `.gitignore`: it holds the demo cluster's admin credentials.

## Testing

Both scripts live in `test/`. They were written during development and moved
into the repo afterwards; the move changed only their paths, and they have not
been re-run from their new location.

```bash
# Everything from an empty laptop through the drain step, over the runner's
# HTTP API, with traffic running during the pod kill, rollout and drain.
# Deletes and recreates the demo cluster. Takes about 3 minutes.
test/e2e.sh

# Presses real keys in headless Chrome and saves screenshots to test/shots/.
# Needs Google Chrome, and the cluster up with the app deployed.
node test/ui-drive.js live
```

What to look for in `test/e2e.sh` output: every command ends `-> exit 0`, the
`HITS` blocks are evenly split between pods, and each says `errors 0`.

What has been verified, and how:

| Thing | Verified |
| --- | --- |
| Steps 1 to 13 through the runner, zero errors under load | `test/e2e.sh` |
| UI layout, keys, scale and rollout animations | `test/ui-drive.js` screenshots |
| Step 14 mechanics (stop a worker, recovery, restart) | prototype on a scratch cluster, then run by hand through the UI |
| `kubectl rollout restart` in step 13 actually rebalancing | **not verified**, see below |
| "A command keeps showing what it ran" and the "N gone" traffic row | script parses; **not yet checked in a browser** |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Header says "no cluster" although one exists | The runner only looks at `.kube/config` in this folder. If the cluster was created some other way, run `k3d kubeconfig get talk > .kube/config`, or just `./demo.sh reset` and create it from step 2. |
| `kubectl` in your terminal shows the wrong cluster or nothing | You have not run `source env.sh` in that terminal. |
| Step 2 fails: port is already allocated | Something else is on 8080. `./demo.sh check` tells you; stop it or change the port in `cluster/k3d.yaml` and `APP` in `demo/server.js`. |
| Step 2 fails: cluster already exists | `./demo.sh reset`. |
| Step 8 `curl` returns `404 page not found` | The ingress controller is still starting (it can take a minute after cluster creation). Press Again. |
| Pods stuck in `ErrImagePull` / `ImagePullBackOff` | The image was not imported into this cluster. Run the two commands in step 5 (and the first two in step 12 for v2). |
| Step 14 takes minutes instead of about 30 seconds | The cluster was created before the timing flags were added to `cluster/k3d.yaml`. `./demo.sh reset` and recreate. |
| Edited `steps.js` but nothing changed | Refresh the browser. If you edited `server.js`, restart `./demo.sh`. |
| Everything fails with "Cannot connect to the Docker daemon" | OrbStack is not running. |

## Known gaps and ideas

**Open question: rebalancing after a node comes back.** Step 13 has an optional
`kubectl rollout restart` whose note claims the new pods spread back out. That
was reported not to rebalance in one run (though the screenshot was taken
after a scale-down from 9 to 3, which can also leave pods bunched up). By
default Kubernetes only mildly prefers spreading pods; it is not a rule. The
likely fix is an explicit `topologySpreadConstraints` block in
`k8s/deployment.yaml`, which is also a good thing to teach. It must be tested
against steps 13 and 14 before it goes in: a strict spread rule can leave
replacement pods stuck Pending when a node is cordoned or dead.

Other things worth knowing:

- k3d v5.6.0 pins Kubernetes 1.27, which is old. Upgrade k3d on the new Mac
  and re-run everything.
- `test/e2e.sh` does not cover step 14.
- Creating the cluster needs the network (see above).

Ideas not built:

- **Audience traffic**: a QR code so phones hit the service and the room
  watches its own requests land on pods. Needs the app exposed beyond
  localhost.
- **Break it on purpose**: a v3 that fails its readiness probe, so the rollout
  stalls while v2 keeps serving, then `kubectl rollout undo`.
- **Autoscaling**: a HorizontalPodAutoscaler reacting to the traffic panel.
