#!/usr/bin/env node
// Demo runner: serves the UI, runs the scripted commands for real, and
// streams live cluster state. No dependencies, Node 18+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.DEMO_PORT || 7777);
const APP = { host: '127.0.0.1', port: 8080 };
const NAMESPACE = 'demo';
const KUBECONFIG = path.join(ROOT, '.kube', 'config');

// Every command runs against this kubeconfig only. It never contains anything
// but the demo cluster, so the demo cannot touch any other cluster.
fs.mkdirSync(path.dirname(KUBECONFIG), { recursive: true });
const ENV = { ...process.env, KUBECONFIG, BUILDKIT_PROGRESS: 'plain', DOCKER_CLI_HINTS: 'false' };

const loadSteps = () => {
  delete require.cache[require.resolve('./steps.js')];
  return require('./steps.js');
};

// Things the UI can trigger outside the script (clicking a pod).
const ACTIONS = {
  kill: 'kubectl delete pod {pod} -n demo --wait=false',
};
const SAFE_PARAM = /^[a-z0-9][a-z0-9.-]{0,80}$/;

function resolveCommand(body) {
  let template;
  if (body.action) template = ACTIONS[body.action];
  else template = (loadSteps().find((s) => s.id === body.step)?.commands[body.index] || {}).cmd;
  if (!template) return null;
  let ok = true;
  const cmd = template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = String((body.params || {})[key] || '');
    if (!SAFE_PARAM.test(value)) ok = false;
    if (key === 'node' && !value.startsWith('k3d-talk-')) ok = false; // only ever the demo's own nodes
    return value;
  });
  return ok ? cmd : null;
}

// ---- running commands -------------------------------------------------------
let running = null;

function run(cmd, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const send = (msg) => res.write(JSON.stringify(msg) + '\n');
  const child = spawn('/bin/bash', ['-c', cmd], { cwd: ROOT, env: ENV });
  running = child;
  send({ t: 'start', cmd });
  child.stdout.on('data', (d) => send({ t: 'out', d: d.toString() }));
  child.stderr.on('data', (d) => send({ t: 'out', d: d.toString() }));
  child.on('error', (err) => send({ t: 'out', d: String(err) + '\n' }));
  child.on('close', (code, signal) => {
    if (running === child) running = null;
    send({ t: 'exit', code: code ?? 1, signal });
    res.end();
    poll();
  });
}

// ---- live cluster state -----------------------------------------------------
const kubectl = (args) =>
  new Promise((resolve) => {
    execFile('kubectl', [...args, '-o', 'json', '--request-timeout=3s'], { env: ENV, timeout: 5000, maxBuffer: 16 << 20 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out).items || []); } catch { resolve(null); }
    });
  });

let state = { cluster: false };
let stateJson = JSON.stringify(state);
let polling = false;
const clients = new Set();

async function readState() {
  if (!fs.existsSync(KUBECONFIG) || fs.statSync(KUBECONFIG).size === 0) return { cluster: false };
  const [top, objs, ingressPods] = await Promise.all([
    kubectl(['get', 'nodes,namespaces']),
    kubectl(['get', 'deployments,services,ingresses,pods', '-n', NAMESPACE]),
    kubectl(['get', 'pods', '-n', 'kube-system', '-l', 'app.kubernetes.io/name=traefik']),
  ]);
  const ingressNodes = new Set((ingressPods || []).map((p) => p.spec.nodeName));
  if (!top) return { cluster: false };
  const kind = (list, k) => (list || []).filter((o) => o.kind === k);
  const nodes = kind(top, 'Node').map((n) => ({
    name: n.metadata.name,
    role: 'node-role.kubernetes.io/control-plane' in (n.metadata.labels || {}) ? 'control-plane' : 'worker',
    ready: (n.status.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
    cordoned: !!n.spec.unschedulable,
    ingress: ingressNodes.has(n.metadata.name), // hosts the ingress controller
  }));
  nodes.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'control-plane' ? -1 : 1));
  const dep = kind(objs, 'Deployment')[0];
  const svc = kind(objs, 'Service')[0];
  const pods = kind(objs, 'Pod').map((p) => {
    const cs = (p.status.containerStatuses || [])[0] || {};
    return {
      name: p.metadata.name,
      node: p.spec.nodeName || null,
      ip: p.status.podIP || null,
      phase: p.status.phase,
      ready: (p.status.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
      terminating: !!p.metadata.deletionTimestamp,
      waiting: cs.state?.waiting?.reason || null,
      version: ((p.spec.containers[0].image || '').split(':')[1]) || '',
      created: p.metadata.creationTimestamp,
    };
  });
  pods.sort((a, b) => a.created.localeCompare(b.created) || a.name.localeCompare(b.name));
  return {
    cluster: true,
    nodes,
    namespaces: kind(top, 'Namespace').map((n) => n.metadata.name),
    ns: kind(top, 'Namespace').some((n) => n.metadata.name === NAMESPACE),
    deployment: dep && {
      want: dep.spec.replicas ?? 0,
      ready: dep.status.readyReplicas ?? 0,
      image: dep.spec.template.spec.containers[0].image,
    },
    service: svc && { ip: svc.spec.clusterIP, port: svc.spec.ports?.[0]?.port },
    ingress: kind(objs, 'Ingress').length > 0,
    pods,
  };
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    state = await readState();
    const json = JSON.stringify(state);
    if (json !== stateJson) {
      stateJson = json;
      for (const c of clients) c.write(`data: ${json}\n\n`);
    }
  } finally {
    polling = false;
  }
}
setInterval(poll, 700);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);

// ---- one request through the front door --------------------------------------
function hit(res) {
  const started = Date.now();
  let done = false;
  const reply = (obj) => {
    if (done) return;
    done = true;
    json(res, { ms: Date.now() - started, ...obj });
  };
  const req = http.get({ ...APP, path: '/api', agent: false, timeout: 1500 }, (r) => {
    let body = '';
    r.on('data', (d) => (body += d));
    r.on('end', () => {
      if (r.statusCode !== 200) return reply({ ok: false, error: `HTTP ${r.statusCode}` });
      try { reply({ ok: true, ...JSON.parse(body) }); } catch { reply({ ok: false, error: 'bad response' }); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (e) => reply({ ok: false, error: e.code || e.message }));
}

// ---- http ---------------------------------------------------------------------
const json = (res, obj, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });

const server = http.createServer(async (req, res) => {
  // Local only: refuse anything not addressed to localhost (DNS rebinding) or
  // posted from another site.
  const host = (req.headers.host || '').split(':')[0];
  const origin = req.headers.origin;
  if (!['localhost', '127.0.0.1'].includes(host) || (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
    return json(res, { error: 'forbidden' }, 403);
  }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/steps') {
    const steps = loadSteps().map((s) => ({
      ...s,
      files: (s.files || []).map((f) => ({ ...f, text: fs.readFileSync(path.join(ROOT, f.path), 'utf8') })),
    }));
    return json(res, { steps, kubeconfig: KUBECONFIG, root: ROOT, app: `http://localhost:${APP.port}` });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${stateJson}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/hit') return hit(res);
  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (running) return json(res, { error: 'a command is already running' }, 409);
    const cmd = resolveCommand(await readBody(req));
    if (!cmd) return json(res, { error: 'unknown command' }, 400);
    return run(cmd, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (running) running.kill('SIGINT');
    return json(res, { ok: true });
  }
  json(res, { error: 'not found' }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Demo runner:  http://localhost:${PORT}`);
  console.log(`  Kubeconfig:   ${KUBECONFIG}`);
  console.log(`  Your own terminal:  source env.sh\n`);
  poll();
});
