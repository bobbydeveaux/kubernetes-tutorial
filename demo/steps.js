// The run-of-show. Edit freely: the UI and server read everything from here.
//
// step:    { id, act, title, say, files?, commands, cli? }
// command: { cmd, note?, optional?, confirm?, params? }
//   optional -> skipped by Enter/Space, run it by clicking
//   confirm  -> needs a second press (destructive)
//   params   -> { pod: 'firstPod' | node: 'podNode' | node: 'cordonedNode' }
//               (also node: 'busyNode' | 'downNode')
//               filled in from live cluster state when the command runs
// file:    { path, notes: [{ match, span?, text }] }  match = text on the first line to highlight

module.exports = [
  {
    id: 'engine',
    act: 'Cluster',
    title: 'Start with nothing',
    say: 'All we have is a container engine: OrbStack. No Kubernetes yet. Everything from here on is real and running on this laptop.',
    commands: [
      { cmd: "docker info --format '{{.OperatingSystem}} | {{.NCPU}} CPUs | {{.ServerVersion}}'" },
      { cmd: 'k3d cluster list', note: 'k3d runs Kubernetes nodes as containers. No clusters yet.' },
    ],
  },
  {
    id: 'create',
    act: 'Cluster',
    title: 'Spin up a cluster',
    say: 'One control plane and three workers. Each node is a container on OrbStack, but to Kubernetes they are four separate machines.',
    files: [
      {
        path: 'cluster/k3d.yaml',
        notes: [
          { match: 'servers: 1', text: 'The control plane: API server, scheduler, the brain.' },
          { match: 'agents: 3', text: 'Three worker nodes. This is where our app will run.' },
          { match: 'port: 127.0.0.1:8080:80', text: 'Port 8080 on the laptop is wired to the cluster front door (the ingress).' },
          { match: 'node-taint', text: 'Keep apps off the control plane, as you would in production.' },
        ],
      },
    ],
    commands: [
      { cmd: 'k3d cluster create --config cluster/k3d.yaml', note: 'About 30 seconds.' },
      { cmd: "docker ps --filter name=k3d-talk --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}'", note: 'The reveal: the "machines" are containers.' },
    ],
  },
  {
    id: 'nodes',
    act: 'Cluster',
    title: 'Meet the nodes',
    say: 'kubectl is how we talk to the cluster. First question you always ask: what machines do I have?',
    commands: [
      { cmd: 'kubectl get nodes' },
      { cmd: 'kubectl get nodes -o wide', optional: true, note: 'More detail: IPs, OS, container runtime.' },
    ],
    cli: ['kubectl get nodes', 'kubectl describe node k3d-talk-agent-0'],
  },
  {
    id: 'namespaces',
    act: 'Cluster',
    title: 'Namespaces',
    say: 'Namespaces are folders for your cluster. Kubernetes keeps its own machinery in kube-system. We will make one for our app.',
    files: [
      {
        path: 'k8s/namespace.yaml',
        notes: [
          { match: 'apiVersion', text: 'Every manifest starts the same way: which API...' },
          { match: 'kind', text: '...what kind of thing...' },
          { match: 'metadata', span: 2, text: '...and what it is called. That is the whole pattern.' },
        ],
      },
    ],
    commands: [
      { cmd: 'kubectl get ns' },
      { cmd: 'kubectl get pods -n kube-system', optional: true, note: 'The cluster runs itself as pods.' },
      { cmd: 'kubectl apply -f k8s/namespace.yaml', note: 'Declarative: "make the cluster look like this file".' },
      { cmd: 'kubectl get ns' },
    ],
    cli: ['kubectl get ns', 'kubectl create namespace scratch --dry-run=client -o yaml'],
  },
  {
    id: 'image',
    act: 'App',
    title: 'Build the app',
    say: 'A tiny web service whose only job is to tell you which pod answered. We build it into an image and hand it to the cluster.',
    files: [
      {
        path: 'app/Dockerfile',
        notes: [
          { match: 'FROM golang', span: 5, text: 'Stage 1: compile the program.' },
          { match: 'FROM scratch', span: 4, text: 'Stage 2: ship only the binary. The image is a few megabytes.' },
        ],
      },
      {
        path: 'app/main.go',
        notes: [
          { match: 'func whoami()', span: 12, text: 'Reads its own pod name, node and IP from environment variables.' },
          { match: 'Kubernetes sends SIGTERM', span: 2, text: 'Shuts down politely so no request is dropped.' },
        ],
      },
    ],
    commands: [
      { cmd: 'docker build -t whoami:v1 app/' },
      { cmd: 'k3d image import whoami:v1 -c talk', note: 'Normally you push to a registry. Locally we copy the image straight onto the nodes.' },
    ],
  },
  {
    id: 'deployment',
    act: 'App',
    title: 'Deployment: run 3 copies',
    say: 'A Deployment says "I want three of these, always". Kubernetes decides where they go and keeps it true. Watch the cluster map.',
    files: [
      {
        path: 'k8s/deployment.yaml',
        notes: [
          { match: 'replicas: 3', text: 'The desired state. Not "start 3", but "there should be 3".' },
          { match: 'selector:', span: 3, text: 'How the Deployment recognises its own pods: by label.' },
          { match: 'template:', span: 4, text: 'The pod template: a stamp for making identical pods.' },
          { match: 'image: whoami:v1', text: 'The image we just built.' },
          { match: 'readinessProbe:', span: 4, text: 'No traffic until the pod says it is ready.' },
          { match: 'env:', span: 13, text: 'Downward API: the pod is told its own name, node and IP.' },
        ],
      },
    ],
    commands: [
      { cmd: 'kubectl apply -f k8s/deployment.yaml' },
      { cmd: 'kubectl get deployments -n demo' },
      { cmd: 'kubectl get pods -n demo -o wide', note: 'Three pods, spread across the workers.' },
    ],
    cli: ['kubectl get deployments -n demo', 'kubectl get pods -n demo -o wide', 'kubectl logs -n demo deploy/whoami'],
  },
  {
    id: 'service',
    act: 'App',
    title: 'Service: one stable address',
    say: 'Pods come and go and their IPs change. A Service is one stable name and IP in front of whichever pods carry the label.',
    files: [
      {
        path: 'k8s/service.yaml',
        notes: [
          { match: 'selector:', span: 2, text: 'Same label as the Deployment. This is the glue: any ready pod with app=whoami gets traffic.' },
          { match: 'port: 80', span: 2, text: 'Listen on 80, forward to the container on 8080.' },
        ],
      },
    ],
    commands: [
      { cmd: 'kubectl apply -f k8s/service.yaml' },
      { cmd: 'kubectl get service -n demo' },
      { cmd: 'kubectl get endpoints -n demo', note: 'The Service found our three pods by label.' },
    ],
    cli: ['kubectl get svc,endpoints -n demo'],
  },
  {
    id: 'ingress',
    act: 'App',
    title: 'Ingress: the front door',
    say: 'The Service is only reachable inside the cluster. An Ingress is the rule that lets the outside world in.',
    files: [
      {
        path: 'k8s/ingress.yaml',
        notes: [
          { match: 'path: /', span: 2, text: 'Any request for / and below...' },
          { match: 'service:', span: 4, text: '...goes to our Service on port 80.' },
        ],
      },
    ],
    commands: [
      { cmd: 'kubectl apply -f k8s/ingress.yaml' },
      { cmd: 'kubectl get ingress -n demo' },
      { cmd: 'curl -s localhost:8080/api', note: 'From the laptop, through the front door, to a pod.' },
    ],
    cli: ['curl localhost:8080/api', 'open http://localhost:8080'],
  },
  {
    id: 'loadbalance',
    act: 'Superpowers',
    title: 'Load balancing',
    say: 'Same URL, twelve requests. Look at who answers. Then switch on live traffic (press L) and leave it running for the rest of the demo.',
    commands: [
      { cmd: 'for i in $(seq 1 12); do curl -s localhost:8080/api; done' },
    ],
    cli: ['while true; do curl -s localhost:8080/api; sleep 0.3; done', 'open http://localhost:8080   # refresh, refresh, refresh'],
  },
  {
    id: 'selfheal',
    act: 'Superpowers',
    title: 'Self-healing',
    say: 'Kill a pod. We said "there should be 3", so Kubernetes notices there are 2 and makes another. Nobody gets paged. (You can also click the x on any pod in the map.)',
    commands: [
      { cmd: 'kubectl delete pod {pod} -n demo --wait=false', params: { pod: 'firstPod' } },
      { cmd: 'kubectl get pods -n demo', note: 'Still three. One is brand new: check the AGE column.' },
    ],
    cli: ['kubectl get pods -n demo -w'],
  },
  {
    id: 'scale',
    act: 'Superpowers',
    title: 'Scale out',
    say: 'Black Friday. We need more. One command, and traffic spreads across the new pods as they become ready.',
    commands: [
      { cmd: 'kubectl scale deployment whoami -n demo --replicas=9' },
      { cmd: 'kubectl get deployments -n demo' },
      { cmd: 'kubectl scale deployment whoami -n demo --replicas=3', optional: true, note: 'And back down again.' },
    ],
    cli: ['kubectl scale deployment whoami -n demo --replicas=5'],
  },
  {
    id: 'rollout',
    act: 'Superpowers',
    title: 'Zero-downtime deploy',
    say: 'Ship version 2 while traffic is flowing. Kubernetes swaps pods a few at a time and only sends traffic to new ones once they are ready. Watch the error counter stay at zero.',
    commands: [
      { cmd: 'docker build --build-arg VERSION=v2 -t whoami:v2 app/' },
      { cmd: 'k3d image import whoami:v2 -c talk' },
      { cmd: 'kubectl set image deployment/whoami whoami=whoami:v2 -n demo' },
      { cmd: 'kubectl rollout status deployment/whoami -n demo' },
      { cmd: 'kubectl rollout undo deployment/whoami -n demo', optional: true, note: 'Bad release? One command to go back.' },
    ],
    cli: ['kubectl rollout history deployment/whoami -n demo'],
  },
  {
    id: 'drain',
    act: 'Superpowers',
    title: 'Drain a node (planned)',
    say: 'A machine needs patching. Drain it: its pods are moved to the other nodes first, so the app never goes down. Then notice what happens, or rather does not, when the node comes back.',
    commands: [
      { cmd: 'kubectl drain {node} --pod-selector=app=whoami', params: { node: 'podNode' }, note: 'Evicts just our app, so we do not knock over the cluster\'s own ingress controller mid-demo.' },
      { cmd: 'kubectl get nodes' },
      { cmd: 'kubectl get pods -n demo -o wide', note: 'Nothing left on the drained node.' },
      { cmd: 'kubectl uncordon {node}', params: { node: 'cordonedNode' }, note: 'Patched. It can take work again, but look: it stays empty. Kubernetes never moves a running pod just to even things out.' },
      { cmd: 'kubectl rollout restart deployment/whoami -n demo', optional: true, note: 'New pods get scheduled fresh, so the next deploy (or this restart) spreads them out again.' },
    ],
  },
  {
    id: 'hostloss',
    act: 'Superpowers',
    title: 'Lose a host (unplanned)',
    say: 'No warning this time: pull the plug on a machine with live traffic on it. Kubernetes cannot tell a dead node from a slow one, so it waits about 20 seconds before declaring it gone. Expect some errors in that window. Then it replaces every lost pod on the machines that are left.',
    commands: [
      { cmd: 'kubectl scale deployment whoami -n demo --replicas=9', note: 'Scaled out, so a third of our capacity is on each machine.' },
      { cmd: 'docker stop {node}', params: { node: 'busyNode' }, note: 'The node is a container, so this is the power cable. Watch the map and the error counter.' },
      { cmd: 'kubectl get nodes', note: 'After about 20 seconds: NotReady.' },
      { cmd: 'kubectl get pods -n demo -o wide', note: 'Nine running again on two machines. The lost ones are stuck Terminating: nobody is left on that node to confirm they stopped.' },
      { cmd: 'docker start {node}', params: { node: 'downNode' }, note: 'The machine comes back, rejoins, and tidies up its ghosts.' },
      { cmd: 'kubectl scale deployment whoami -n demo --replicas=3', optional: true },
    ],
  },
  {
    id: 'cleanup',
    act: 'Wrap up',
    title: 'Tear it all down',
    say: 'Everything we built was described in four small YAML files. Delete the namespace and it is all gone. Delete the cluster and the laptop is back to where we started.',
    commands: [
      { cmd: 'kubectl delete namespace demo', confirm: true },
      { cmd: 'k3d cluster delete talk', confirm: true, optional: true },
    ],
  },
];
