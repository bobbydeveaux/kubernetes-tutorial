// Drives the demo UI in headless Chrome over the DevTools protocol:
// presses real keys, waits, takes screenshots into test/shots/, and reports
// console errors. Needs Google Chrome, Node 22+, and port 7777 free.
//
//   node test/ui-drive.js live    cluster up with the app deployed (run through
//                                 step 8 first); exercises scale + rollout
//   node test/ui-drive.js empty   just screenshots the first screen
//
// (Chrome's --screenshot flag hangs on this page because of the live event
// stream, which is why this talks to DevTools directly.)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots'); // gitignored
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', ['demo/server.js'], { cwd: ROOT, stdio: 'ignore' });
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${OUT}/profile`,
    '--window-size=1600,950', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  const done = () => { srv.kill(); chrome.kill(); };
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch {}
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const pending = new Map(); const errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' '));
    };
    const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    const key = async (k, code = k) => {
      const base = { key: k, code, windowsVirtualKeyCode: { Enter: 13, ArrowRight: 39, l: 76 }[k] || 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    const shot = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
      console.log('shot', name);
    };
    const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });

    const plan = process.argv[2] || 'live';
    if (plan === 'live') {
      await send('Page.navigate', { url: 'http://localhost:7777/#scale' });
      await sleep(1500); await key('l'); await key('Enter'); await sleep(9000);
      await shot('7-scale-9');
      await evalJs(`document.querySelector('[data-run="2"]').click()`); await sleep(8000);
      await evalJs(`location.hash = 'rollout'`); await sleep(500);
      console.log('hash nav ->', await evalJs(`document.getElementById('title').textContent`));
      await key('Enter'); await sleep(9000); await key('Enter'); await sleep(7000); await key('Enter'); await sleep(1500); await key('Enter'); await sleep(2500);
      await shot('8-rollout-midway');
      await sleep(12000);
      await shot('9-rollout-done');
    } else {
      await send('Page.navigate', { url: 'http://localhost:7777/' });
      await sleep(1500);
      await shot('0-empty');
    }
    console.log('page errors:', errors.length ? errors : 'none');
    console.log('overflow check:', await evalJs(`JSON.stringify({docW: document.documentElement.scrollWidth, winW: innerWidth, docH: document.documentElement.scrollHeight, winH: innerHeight})`));
  } catch (e) { console.log('driver failed', e); }
  done();
})();
