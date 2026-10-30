// Runs the app's injected runtime in real Chromium against a fake page and a fake bridge.
// Needs the blobs from BuildBlobs.java in tests/out (see tests/README.md).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'out');
const blobs = fs.readdirSync(outDir).filter(f => f.endsWith('.blob.js')).sort()
  .map(f => fs.readFileSync(path.join(outDir, f), 'utf8'));

const fakeBridge = `
  window.results = {};
  window.bridgeLog = [];
  (function () {
    var store = {}, jobs = {}, seq = 0;
    function ok(t) { if (t !== 'TESTTOKEN') { bridgeLog.push('BAD TOKEN'); return false; } return true; }
    function vals(id) { return store[id] || (store[id] = {}); }
    window.ScriptPocketBridge = {
      getValue: function (t, id, k) { if (!ok(t)) return null; var v = vals(id)[k]; return v === undefined ? null : v; },
      setValue: function (t, id, k, j) { if (ok(t)) vals(id)[k] = j; },
      deleteValue: function (t, id, k) { if (ok(t)) delete vals(id)[k]; },
      listValues: function (t, id) { return ok(t) ? JSON.stringify(Object.keys(vals(id))) : '[]'; },
      xhrStart: function (t, id, d) {
        if (!ok(t)) return '';
        d = JSON.parse(d); var rid = 'r' + (++seq);
        var res;
        if (d.url.indexOf('fail.example') >= 0) res = { error: 'Unable to resolve host' };
        else if (d.url.slice(-4) === '/bin') res = { status: 200, base64: btoa(String.fromCharCode(1, 2, 255)), finalUrl: d.url };
        else res = { status: 201, statusText: 'Created', headers: 'content-type: application/json\\r\\n', finalUrl: d.url,
          text: JSON.stringify({ echo: d.data, method: d.method, header: d.headers['X-Test'] }) };
        jobs[rid] = { polls: 0, res: JSON.stringify(res) };
        return rid;
      },
      xhrPoll: function (t, rid) { if (!ok(t)) return ''; var j = jobs[rid]; if (++j.polls < 3) return ''; delete jobs[rid]; return j.res; },
      xhrAbort: function () {},
      log: function (t, id, level, msg) { bridgeLog.push(id + ':' + level + ':' + msg.split('\\n')[0]); },
      ran: function (t, id) { bridgeLog.push('ran:' + id); },
      registerMenu: function (t, id, cmd, name) { bridgeLog.push('menu:' + id + ':' + cmd + ':' + name); },
      unregisterMenu: function () {},
      notify: function () {}, setClipboard: function () {}, openInTab: function () {}
    };
  })();
`;

const page1 = `<!doctype html><html><head><title>t</title></head><body>
<div id="box">box</div><iframe src="https://test.example/frame"></iframe>
<script>window.pageScriptSawBridge = typeof ScriptPocketBridge;</script></body></html>`;

let failures = 0;
function check(cond, label, got) {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + '  got: ' + JSON.stringify(got)); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(fakeBridge);
  for (const b of blobs) await ctx.addInitScript(b);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.endsWith('/frame')) return route.fulfill({ contentType: 'text/html', body: '<p>frame</p>' });
    return route.fulfill({ contentType: 'text/html', body: page1 });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://test.example/page1');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => window.results);
  const log = await page.evaluate(() => window.bridgeLog);

  console.log('document-start script');
  check(r.start && r.start.readyState === 'loading' && !r.start.bodyExists, 'runs before the page is parsed', r.start);
  check(r.start.seesBridgeToken === false, 'user code cannot see the token or bridge helpers', r.start.seesBridgeToken);
  check(r.start.unsafeIsWindow && r.start.thisIsWindow, 'unsafeWindow and this are window', r.start);
  check(r.start.info === 'Start runner|1.0|ScriptPocket', 'GM_info', r.start.info);
  check(JSON.stringify(r.start.get) === '{"n":1,"list":[1,2]}', 'GM_setValue / GM_getValue round trip', r.start.get);
  check(r.start.missing === 'default', 'GM_getValue default', r.start.missing);
  check(JSON.stringify(r.start.list) === '["count","flag"]', 'GM_listValues', r.start.list);
  check(JSON.stringify(r.start.afterDelete) === '["count"]', 'GM_deleteValue', r.start.afterDelete);
  check(JSON.stringify(r.start.heard) === '[["count",1,2]]', 'value change listener', r.start.heard);
  check(await page.evaluate(() => typeof leaked) === 'undefined', 'top-level var stays inside the script', null);

  console.log('document-end / idle / matching');
  check(r.end && r.end.readyState !== 'loading' && r.end.box, 'document-end runs after the DOM is ready', r.end);
  check(r.end.resource === 'héllo resource', 'GM_getResourceText (UTF-8)', r.end.resource);
  check(r.end.resUrl === 'data:text/plain;base64,', 'GM_getResourceURL', r.end.resUrl);
  check(r.idle && r.idle.color === 'rgb(255, 0, 0)', 'GM_addStyle applied (seen by idle script)', r.idle);
  check(r.idle.required === 'undefined', "one script's @require doesn't leak into another", r.idle.required);
  check(r.nomatch === undefined, 'non-matching @match skipped (incl. lookalike host)', r.nomatch);
  check(r.excluded === undefined, '@exclude wins', r.excluded);
  check(r.regex === true, '/regex/ @include', r.regex);
  check(r.frames === 1, '@noframes runs once, in the top page only', r.frames);

  console.log('errors stay contained');
  check(r.broken === undefined, 'broken script does not run', r.broken);
  check(log.some(l => l.startsWith('07-crash:error:crashed: Error: boom')), 'crash is caught and logged', log);
  check(errors.length > 0 && errors.every(e => /Unexpected token/.test(e)), 'only the broken script reports an error (once per frame)', errors);

  console.log('network, libraries, menu');
  check(r.require === 42, '@require code runs before the script', r.require);
  check(r.xhr && r.xhr.status === 201 && r.xhr.body.echo === 'hello' && r.xhr.body.method === 'POST' && r.xhr.body.header === '1',
    'GM_xmlhttpRequest POST with json response', r.xhr);
  check(r.xhr.finalUrl === 'https://test.example/api' && r.xhr.ctx === 'ctx1', 'relative url resolved, context passed', r.xhr);
  check(r.xhrError === 'Unable to resolve host', 'onerror fires', r.xhrError);
  check(JSON.stringify(r.bin) === '[1,2,255]', 'GM.xmlHttpRequest arraybuffer', r.bin);
  check(r.promiseGet === 0, 'GM.getValue promise, storage is per script', r.promiseGet);
  check(log.includes('menu:08-xhr-require:c1:Say hi'), 'menu command registered', log);
  await page.evaluate(() => window['__spm_k3y_08-xhr-require']('c1'));
  check(await page.evaluate(() => window.results.menu) === 'clicked', 'menu command runs when called', null);
  check(!log.includes('BAD TOKEN'), 'every bridge call carried the token', log);
  check(!(await page.evaluate(() => Object.getOwnPropertyNames(window).some(k => k.indexOf('TESTTOKEN') >= 0))), 'token never appears in window keys', null);

  // Same blobs injected again (old-WebView fallback path) must not double-run.
  for (const b of blobs) await page.evaluate(b).catch(() => {});
  check(await page.evaluate(() => window.bridgeLog.filter(l => l === 'ran:01-start').length) === 1, 'second injection is ignored', null);

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
})();
