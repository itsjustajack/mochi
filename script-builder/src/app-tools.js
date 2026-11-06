/* JSB app: output, analyzer, tester, chat simulator, ES5 checker, card blocks, guide. */
(function (A) {
  'use strict';
  var h = A.h, J = A.JSB, T = window.JSBTest, C = window.JSBCheck;
  var panel = A.panel, grid = A.grid, fText = A.fText, fNum = A.fNum, fCheck = A.fCheck, fSelect = A.fSelect;

  /* ---------- syntax highlight (cosmetic) ---------- */
  var TOK = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(var|function|return|if|else|for|while|do|break|continue|new|typeof|instanceof|true|false|null|undefined|try|catch|finally|in|this|throw|switch|case|default|delete)\b|(\b\d+(?:\.\d+)?\b)/g;
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function highlight(code) {
    if (code.length > 400000) return esc(code);
    var out = '', last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(code))) {
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = TOK.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  function codeBox(title, code, opts) {
    opts = opts || {};
    var pre = h('pre', { class: 'code', tabindex: '0', 'aria-label': title });
    pre.innerHTML = highlight(code);
    var head = h('div', { class: 'cbh' }, [h('b', { text: title }), h('span', { class: 'tag', text: A.kb(code.length) }), opts.badge || null, h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary sm', type: 'button', text: 'Copy', onclick: function () { A.copy(code, opts.what || 'Script'); } }),
      opts.file ? h('button', { class: 'btn sm', type: 'button', text: 'Save .js', onclick: function () { A.save(opts.file, code, { type: 'text/javascript' }); } }) : null]);
    return h('div', { class: 'codebox' }, [head, pre]);
  }
  A.codeBox = codeBox;
  function es5Badge(code) {
    if (!C) return null;
    var r; try { r = C.check(code); } catch (e) { return null; }
    var errs = r.issues.filter(function (i) { return i.severity === 'error'; }).length;
    return h('span', { class: 'tag ' + (r.es5 && !errs ? 'ok' : 'bad'), text: r.es5 && !errs ? 'Strict ES5 \u2713' : 'ES5 problems: ' + (errs || 1) });
  }

  /* ================= OUTPUT ================= */
  A.views.output = function () {
    var view = h('div', { class: 'view wide' });
    view.appendChild(h('div', { class: 'head' }, [h('div', { class: 't' }, [h('h1', { text: 'Script output' }), h('p', { class: 'lede', text: 'Paste this into a Janitor Advanced script. It appends to personality and scenario and never overwrites them.' })])]));
    var body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    view.appendChild(body);
    function draw() {
      body.innerHTML = '';
      if (A.compileError) { body.appendChild(h('div', { class: 'banner bad', text: 'The script could not be built: ' + A.compileError })); return; }
      var c = A.compiled; if (!c) return;
      if (!c.modules.length) { body.appendChild(h('div', { class: 'banner warn', text: 'No modules are on. Turn some on from the Start page.' })); return; }
      var tab = Math.min(A.ui.outTab || 0, c.scripts.length - 1);
      if (c.scripts.length > 1) {
        var tabs = h('div', { class: 'tabs', role: 'tablist' });
        c.scripts.forEach(function (s, i) { tabs.appendChild(h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': i === tab ? 'true' : 'false', text: (i + 1) + '. ' + s.title, onclick: function () { A.ui.outTab = i; draw(); } })); });
        body.appendChild(tabs);
        body.appendChild(h('p', { class: 'muted small', text: 'Split mode: make one Advanced script per tab and assign all of them to the character. Each one runs on its own.' }));
      }
      var s = c.scripts[tab];
      var e = A.countFind('error'), w = A.countFind('warn');
      if (e || w) body.appendChild(h('div', { class: 'banner ' + (e ? 'bad' : 'warn') }, [(e ? e + ' problem' + (e > 1 ? 's' : '') : w + ' warning' + (w > 1 ? 's' : '')) + ' found in your setup. ', h('a', { href: '#analyze', text: 'Open the Analyzer', onclick: function (ev) { ev.preventDefault(); A.go('analyze'); } })]));
      var code = A.scriptCode(tab) || s.code;
      body.appendChild(codeBox(s.title, code, { file: J.slug(A.P.meta.title || 'script') + (c.scripts.length > 1 ? '-' + s.name : '') + '.js', badge: es5Badge(s.code) }));
      body.appendChild(h('div', { class: 'row' }, [A.fCheck('Include project data so the saved .js can be imported back', A.P.settings, 'embed', { structural: true }), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', type: 'button', text: 'More export formats\u2026', onclick: function () { A.go('io'); } })]));
    }
    draw();
    A.onCompiled = draw;
    view.appendChild(panel('Install it in Janitor', h('ol', { class: 'steps' }, [
      h('li', null, ['Go to ', h('b', { text: 'janitorai.com/scripts' }), ' (profile menu \u2192 Scripts) and create a script of type ', h('b', { text: 'Advanced' }), '.']),
      h('li', { text: 'Delete the template code, paste the script, and save.' }),
      h('li', null, ['Open the script and choose ', h('b', { text: 'Assign to your Characters' }), '. Nothing happens until it is assigned.']),
      h('li', null, ['Start a ', h('b', { text: 'Test Chat' }), ', open ', h('b', { text: 'Show Debug Panel' }), ' and read the ', h('b', { text: 'Changes' }), ' tab after each reply to see exactly what was added.']),
      h('li', { text: 'Turn Debug logging off in Start & settings before you publish.' })
    ])));
    return view;
  };

  /* ================= ANALYZER ================= */
  A.views.analyze = function () {
    var view = h('div', { class: 'view' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Analyzer' }), h('p', { class: 'lede', text: 'Finds keys that fire on every message, rules that can never be true, overlaps, broken regex and budget problems before Janitor does.' })])));
    var body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    view.appendChild(body);
    function draw() {
      body.innerHTML = '';
      var P = A.P, c = A.compiled, F = A.findings;
      var lore = P.modules.lorebook.entries.length, cast = P.modules.ensemble.cast.length, rules = P.modules.rules.list.length;
      var size = c ? c.code.length : 0;
      body.appendChild(h('div', { class: 'stats' }, [
        stat(A.kb(size), 'script size'), stat(c ? c.scripts.length : 0, 'scripts'), stat(c ? c.modules.length : 0, 'modules on'),
        stat(lore, 'lore entries'), stat(cast, 'cast members'), stat(rules, 'rules'), stat('~' + Math.round(P.settings.maxChars / 4), 'max tokens added')
      ]));
      var e = A.countFind('error'), w = A.countFind('warn'), i = A.countFind('info');
      body.appendChild(h('div', { class: 'banner ' + (e ? 'bad' : w ? 'warn' : 'ok'), text: e ? e + ' problem' + (e > 1 ? 's' : '') + ' to fix, ' + w + ' warning' + (w === 1 ? '' : 's') + '.' : w ? 'No problems. ' + w + ' warning' + (w > 1 ? 's' : '') + ' worth a look.' : 'No problems found.' + (i ? ' ' + i + ' note' + (i > 1 ? 's' : '') + ' below.' : '') }));
      var list = h('div', { class: 'items' });
      F.forEach(function (f) {
        var info = J.MODULES.filter(function (m) { return m.id === f.module; })[0];
        list.appendChild(h('div', { class: 'find ' + f.level }, [
          h('span', { class: 'tag ' + (f.level === 'error' ? 'bad' : f.level === 'warn' ? 'warn' : 'acc'), text: f.level === 'error' ? 'problem' : f.level === 'warn' ? 'warning' : 'note' }),
          h('div', { class: 'fm', text: f.message }),
          info ? h('button', { class: 'btn sm', type: 'button', text: info.name, onclick: function () { A.go('mod-' + info.id); } }) : h('span'),
          f.hint ? h('div', { class: 'fh', text: f.hint }) : null
        ]));
      });
      if (F.length) body.appendChild(list);
    }
    function stat(v, l) { return h('div', { class: 'stat' }, [h('b', { text: String(v) }), h('span', { text: l })]); }
    draw();
    A.onCompiled = draw;
    return view;
  };

  /* ================= TESTER ================= */
  var TS = A.test;
  Object.assign(TS, { msg: 'I heard rumors about a dragon. Is that true? Thanks for the ale, by the way.', count: 18, lastMsgs: '', user: 'Alex', date: '2026-10-24T22:30', seed: '', pers: 'Mara is a dry-humoured innkeeper.', scen: 'The common room of the Rusty Lantern.', debug: true, shape: 'objects' });
  function builderCode(debug) {
    if (!debug) return A.compiled ? A.compiled.code : '';
    var p = JSON.parse(JSON.stringify(A.P)); p.settings.debug = true;
    try { return J.compile(p).code; } catch (e) { return A.compiled ? A.compiled.code : ''; }
  }
  A.builderCode = builderCode;
  function parseLast(text, shape) {
    var lines = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return undefined;
    return lines.map(function (l) {
      var bot = /^bot\s*:/i.test(l), msg = l.replace(/^(bot|user)\s*:\s*/i, '');
      return shape === 'strings' ? msg : { message: msg, is_bot: bot };
    });
  }
  function isoUTC(local) { if (!local) return null; var d = new Date(local + 'Z'); return isNaN(d.getTime()) ? null : d.toISOString(); }

  function resultView(r, mode) {
    var g = T.grade(r, { budget: A.P.settings.maxChars });
    var hasErr = g.some(function (f) { return f.level === 'error'; });
    var box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    box.appendChild(h('div', { class: 'row' }, [
      h('span', { class: 'tag ' + (r.error || hasErr ? 'bad' : g.length ? 'warn' : 'ok'), text: r.error ? 'Threw an error' : hasErr ? 'Problems found' : g.length ? 'Ran with warnings' : 'Ran cleanly' }),
      h('span', { class: 'tag', text: r.ms + ' ms' }), h('span', { class: 'tag', text: (r.addedP.length + r.addedS.length) + ' chars added' }),
      mode ? h('span', { class: 'tag', text: mode === 'worker' ? 'sandboxed worker' : 'ran in page' }) : null
    ]));
    g.forEach(function (f) { box.appendChild(h('div', { class: 'banner ' + (f.level === 'error' ? 'bad' : 'warn'), text: f.text })); });
    box.appendChild(h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Added to personality' }), h('div', { class: 'out' + (r.addedP ? '' : ' none'), text: r.addedP || 'Nothing added.' })]));
    box.appendChild(h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Added to scenario' }), h('div', { class: 'out' + (r.addedS ? '' : ' none'), text: r.addedS || 'Nothing added.' })]));
    if (r.logs && r.logs.length) box.appendChild(h('details', { class: 'fold', open: true }, [h('summary', { text: 'Console (' + r.logs.length + ' lines)' }), h('div', { class: 'out', text: r.logs.join('\n') })]));
    return box;
  }

  A.views.test = function () {
    var view = h('div', { class: 'view wide' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Tester & fuzz' }), h('p', { class: 'lede', text: 'Run the script on a message you choose, with a fixed clock and dice, or throw 75 awkward chat states at it to make sure it never breaks.' })])));
    var codeArea = h('textarea', { id: 'tCustom', rows: 8, class: 'mono', spellcheck: 'false', placeholder: 'Paste any Janitor script here' });
    codeArea.value = TS.custom; codeArea.addEventListener('input', function () { TS.custom = codeArea.value; });
    var srcSel = fSelect('Script to run', TS, 'source', [['builder', 'This project\u2019s script'], ['custom', 'A script I paste']], { onChange: function () { codeWrap.hidden = TS.source !== 'custom'; } });
    var codeWrap = h('div', null, codeArea); codeWrap.hidden = TS.source !== 'custom';
    var left = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px', minWidth: '0' } }, [
      panel('Input', [
        grid([srcSel, fCheck('Force debug logs', TS, 'debug', { hint: 'For this project\u2019s script only.' })], 'two'),
        codeWrap,
        fText('Last message (from the user)', TS, 'msg', { area: true, rows: 3 }),
        grid([fNum('message_count', TS, 'count', { min: 0, step: 1 }), fText('User name', TS, 'user'),
          h('label', { class: 'f', for: 'tDate' }, [h('span', { class: 'l', text: 'Clock (UTC)' }), dateInput(), h('span', { class: 'hint', text: 'Empty = real time now.' })]),
          fText('Dice seed', TS, 'seed', { ph: 'empty = random', hint: 'Same seed, same rolls.' })], 'two'),
        h('details', { class: 'fold' }, [h('summary', { text: 'Recent messages and the character card' }),
          fText('last_messages (one per line, oldest first)', TS, 'lastMsgs', { area: true, rows: 4, mono: true, hint: 'Start a line with "bot:" for a bot message. Empty = not provided.' }),
          fSelect('last_messages shape', TS, 'shape', [['objects', 'Objects with .message'], ['strings', 'Plain strings']]),
          grid([fText('Starting personality', TS, 'pers', { area: true, rows: 2 }), fText('Starting scenario', TS, 'scen', { area: true, rows: 2 })], 'two')]),
        h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', text: 'Run once', onclick: runOnce }), h('button', { class: 'btn', type: 'button', text: 'Fuzz test (75 runs)', onclick: runFuzz })])
      ])
    ]);
    var right = h('div', { style: { minWidth: '0' } }, panel('Result', h('div', { id: 'tOut' }, h('p', { class: 'muted small', text: 'Run the script to see what it adds.' }))));
    view.appendChild(h('div', { class: 'cols' }, [left, right]));
    function dateInput() { var el = h('input', { type: 'datetime-local', id: 'tDate', step: 60 }); el.value = TS.date || ''; el.addEventListener('input', function () { TS.date = el.value; }); return el; }
    function code() { return TS.source === 'custom' ? TS.custom : builderCode(TS.debug); }
    function out() { return document.getElementById('tOut'); }
    function runOnce() {
      var src = code(); if (!src.trim()) { A.toast('There is no script to run.'); return; }
      var input = { chat: { last_message: TS.msg, message_count: TS.count, user_name: TS.user }, date: isoUTC(TS.date), seed: TS.seed === '' ? null : TS.seed, character: { name: 'Bot', personality: TS.pers, scenario: TS.scen } };
      var lm = parseLast(TS.lastMsgs, TS.shape); if (lm) input.chat.last_messages = lm;
      out().innerHTML = ''; out().appendChild(h('p', { class: 'muted small', text: 'Running\u2026' }));
      T.runBatch(src, [input], { timeout: 4000 }).then(function (res) {
        out().innerHTML = '';
        if (res.timedOut) { out().appendChild(h('div', { class: 'banner bad', text: 'Stopped after 4 seconds. The script never finished, which usually means an endless loop. Janitor would hang or drop it.' })); return; }
        if (res.fatal) { out().appendChild(h('div', { class: 'banner bad', text: 'The sandbox failed: ' + res.fatal })); return; }
        out().appendChild(resultView(res.results[0], res.mode));
      });
    }
    function runFuzz() {
      var src = code(); if (!src.trim()) { A.toast('There is no script to run.'); return; }
      out().innerHTML = ''; out().appendChild(h('p', { class: 'muted small', text: 'Running 75 cases\u2026' }));
      var inputs = T.fuzzInputs({ name: 'Bot', personality: 'Original personality.', scenario: 'Original scenario.' });
      T.runBatch(src, inputs, { timeout: 15000 }).then(function (res) {
        var o = out(); o.innerHTML = '';
        if (res.timedOut) { o.appendChild(h('div', { class: 'banner bad', text: 'Stopped after 15 seconds: at least one case never finished (an endless loop?).' })); return; }
        if (res.fatal) { o.appendChild(h('div', { class: 'banner bad', text: 'The sandbox failed: ' + res.fatal })); return; }
        var rows = res.results.map(function (r, i) { return { r: r, label: inputs[i].label, g: T.grade(r, { budget: A.P.settings.maxChars }) }; });
        var bad = rows.filter(function (x) { return x.r.error || x.g.some(function (f) { return f.level === 'error'; }); });
        var warn = rows.filter(function (x) { return !x.r.error && x.g.length && x.g.every(function (f) { return f.level !== 'error'; }); });
        var slow = Math.max.apply(null, rows.map(function (x) { return x.r.ms; }));
        var big = Math.max.apply(null, rows.map(function (x) { return x.r.addedP.length + x.r.addedS.length; }));
        var fired = rows.filter(function (x) { return x.r.addedP || x.r.addedS; }).length;
        o.appendChild(h('div', { class: 'banner ' + (bad.length ? 'bad' : warn.length ? 'warn' : 'ok'), text: bad.length ? bad.length + ' of 75 cases broke.' : warn.length ? 'No crashes. ' + warn.length + ' cases have warnings.' : 'All 75 cases passed: no errors, nothing overwritten, no junk text.' }));
        o.appendChild(h('div', { class: 'stats' }, [st(fired + ' / 75', 'cases that added text'), st(slow + ' ms', 'slowest run'), st(big, 'most chars added'), st(res.mode === 'worker' ? 'worker' : 'page', 'sandbox')]));
        var showAll = false;
        var tblWrap = h('div', { class: 'scroll-x' });
        function table() {
          tblWrap.innerHTML = '';
          var list = showAll ? rows : bad.concat(warn);
          if (!list.length) { tblWrap.appendChild(h('p', { class: 'muted small', text: 'Nothing flagged.' })); return; }
          var tb = h('tbody');
          list.forEach(function (x) {
            tb.appendChild(h('tr', null, [h('td', { text: x.label }), h('td', { class: 'num', text: x.r.ms + ' ms' }), h('td', { class: 'num', text: String(x.r.addedP.length + x.r.addedS.length) }),
              h('td', { text: x.r.error ? x.r.error : x.g.length ? x.g.map(function (f) { return f.text; }).join(' ') : 'OK' })]));
          });
          tblWrap.appendChild(h('table', { class: 'res' }, [h('thead', null, h('tr', null, [h('th', { text: 'Case' }), h('th', { text: 'Time' }), h('th', { text: 'Chars' }), h('th', { text: 'Result' })])), tb]));
        }
        table();
        o.appendChild(h('div', { class: 'row' }, [h('button', { class: 'btn sm', type: 'button', text: 'Show all 75 cases', onclick: function (e) { showAll = !showAll; e.currentTarget.textContent = showAll ? 'Show flagged only' : 'Show all 75 cases'; table(); } })]));
        o.appendChild(tblWrap);
      });
    }
    function st(v, l) { return h('div', { class: 'stat' }, [h('b', { text: String(v) }), h('span', { text: l })]); }
    return view;
  };

  /* ================= CHAT SIMULATOR ================= */
  var CS = A.chatSim = { msgs: [], start: '2026-10-24T18:00', step: 6, counting: 'all', includeBot: true, window: 10, seed: '', user: 'Alex', debug: false, busy: false };
  var SAMPLE = ['Hi there. Is this the Rusty Lantern?', 'bot:Mara looks up from the bar. "It is. Sit anywhere that isn\u2019t sticky."', 'My name is Alex. Thanks for the warm welcome!', 'bot:"Alex. I\u2019ll remember that."', 'I heard rumors about a dragon in the north. Is it true?', 'bot:Mara sets the mug down a little too hard.', 'Sorry, I didn\u2019t mean to pry. I\u2019m scared of dragons, honestly.', 'bot:"Everyone is. Sensible."', 'Can I hear a secret about your past?'];
  A.views.chat = function () {
    var view = h('div', { class: 'view wide' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Chat simulator' }), h('p', { class: 'lede', text: 'Play a conversation. After each of your messages the script runs as Janitor would run it, and you see exactly what it injected. The clock moves forward each turn.' })])));
    var log = h('div', { class: 'chat', id: 'chatLog', 'aria-live': 'polite' });
    var input = h('textarea', { id: 'chatIn', rows: 2, placeholder: 'Write as the user. Enter sends, Shift+Enter for a new line.' });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUser(); } });
    function draw() {
      log.innerHTML = '';
      if (!CS.msgs.length) log.appendChild(h('div', { class: 'empty', text: 'No messages yet. Write one below, or load the sample conversation.' }));
      CS.msgs.forEach(function (m, i) {
        log.appendChild(h('div', { class: 'msg ' + m.role, text: m.text }));
        if (m.inj) log.appendChild(injView(m.inj, i));
      });
      log.scrollTop = log.scrollHeight;
    }
    function injView(r, i) {
      if (r.timedOut) return h('div', { class: 'inj' }, h('div', { class: 'banner bad', text: 'The script did not finish (endless loop?).' }));
      var g = T.grade(r, { budget: A.P.settings.maxChars });
      var parts = [h('div', { class: 'meta' }, [h('span', { class: 'tag ' + (r.error ? 'bad' : g.length ? 'warn' : 'ok'), text: r.error ? 'error' : g.length ? 'warning' : 'ok' }), 'count ' + r.count, '\u00b7', r.clock, '\u00b7', r.ms + ' ms', '\u00b7', (r.addedP.length + r.addedS.length) + ' chars'])];
      g.forEach(function (f) { parts.push(h('div', { class: 'banner ' + (f.level === 'error' ? 'bad' : 'warn'), text: f.text })); });
      if (r.addedP) parts.push(h('div', null, [h('b', { class: 'tiny', text: 'PERSONALITY +' }), h('pre', { text: r.addedP.replace(/^\s+/, '') })]));
      if (r.addedS) parts.push(h('div', null, [h('b', { class: 'tiny', text: 'SCENARIO +' }), h('pre', { text: r.addedS.replace(/^\s+/, '') })]));
      if (!r.addedP && !r.addedS && !r.error) parts.push(h('span', { class: 'muted', text: 'Nothing injected this turn.' }));
      if (r.logs && r.logs.length) parts.push(h('details', null, [h('summary', { text: 'Console (' + r.logs.length + ')' }), h('pre', { text: r.logs.join('\n') })]));
      return h('div', { class: 'inj' }, parts);
    }
    function clockFor(turn) {
      var base = new Date((CS.start || '2026-10-24T18:00') + 'Z').getTime(); if (isNaN(base)) base = Date.now();
      return new Date(base + turn * (parseFloat(CS.step) || 0) * 60000).toISOString();
    }
    function runFor(idx) {
      var msgs = CS.msgs.slice(0, idx + 1);
      var userTurns = msgs.filter(function (m) { return m.role === 'user'; }).length;
      var count = CS.counting === 'user' ? userTurns : msgs.length;
      var hist = (CS.includeBot ? msgs : msgs.filter(function (m) { return m.role === 'user'; })).slice(-Math.max(1, parseInt(CS.window, 10) || 10));
      var date = clockFor(userTurns - 1);
      var input = { chat: { last_message: msgs[idx].text, message_count: count, user_name: CS.user, last_messages: hist.map(function (m) { return { message: m.text, is_bot: m.role === 'bot' }; }) }, date: date, seed: CS.seed === '' ? null : (parseInt(CS.seed, 10) || 0) + idx, character: { name: 'Bot', personality: 'PERSONALITY.', scenario: 'SCENARIO.' } };
      return T.runBatch(builderCode(CS.debug), [input], { timeout: 4000 }).then(function (res) {
        var r = res.timedOut ? { timedOut: true } : res.results[0] || { error: res.fatal || 'no result', addedP: '', addedS: '', logs: [], ms: 0, keptP: true, keptS: true, typeP: 'string', typeS: 'string' };
        r.count = count; r.clock = date.slice(0, 16).replace('T', ' ') + ' UTC (' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date).getUTCDay()] + ')';
        msgs[idx].inj = r;
      });
    }
    function sendUser() {
      var v = input.value.trim(); if (!v || CS.busy) return;
      input.value = '';
      CS.msgs.push({ role: 'user', text: v });
      CS.busy = true;
      runFor(CS.msgs.length - 1).then(function () { CS.busy = false; draw(); }, function () { CS.busy = false; draw(); });
      draw();
    }
    function sendBot() { var v = input.value.trim(); if (!v) return; input.value = ''; CS.msgs.push({ role: 'bot', text: v }); draw(); }
    function rerunAll() {
      var idxs = []; CS.msgs.forEach(function (m, i) { if (m.role === 'user') idxs.push(i); });
      var p = Promise.resolve();
      idxs.forEach(function (i) { p = p.then(function () { return runFor(i); }); });
      return p.then(draw);
    }
    function loadSample() {
      CS.msgs = SAMPLE.map(function (l) { return /^bot:/.test(l) ? { role: 'bot', text: l.slice(4) } : { role: 'user', text: l }; });
      draw(); rerunAll();
    }
    var settings = h('details', { class: 'fold' }, [h('summary', { text: 'Simulation settings' }), grid([
      h('label', { class: 'f', for: 'csStart' }, [h('span', { class: 'l', text: 'Clock starts at (UTC)' }), (function () { var el = h('input', { type: 'datetime-local', id: 'csStart', step: 60 }); el.value = CS.start; el.addEventListener('input', function () { CS.start = el.value; }); return el; })()]),
      fNum('Minutes per turn', CS, 'step', { min: 0, step: 1 }),
      fSelect('message_count counts', CS, 'counting', [['all', 'Every message'], ['user', 'Only user messages']], { hint: 'Janitor does not document which. Test both.' }),
      fNum('last_messages length', CS, 'window', { min: 1, step: 1 }),
      fCheck('Include bot replies in last_messages', CS, 'includeBot'),
      fCheck('Show debug logs', CS, 'debug'),
      fText('Dice seed', CS, 'seed', { ph: 'empty = random' }),
      fText('User name', CS, 'user')
    ]), h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', text: 'Re-run every turn with these settings', onclick: rerunAll }))]);
    view.appendChild(panel(null, [
      h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: 'Load sample conversation', onclick: loadSample }), h('button', { class: 'btn ghost', type: 'button', text: 'Re-run all', onclick: rerunAll }), h('span', { class: 'spacer' }), A.confirmBtn('Clear chat', 'Click again to clear', 'ghost danger', function () { CS.msgs = []; draw(); })]),
      log,
      h('div', { class: 'composer' }, [input, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [h('button', { class: 'btn primary', type: 'button', text: 'Send as user', onclick: sendUser }), h('button', { class: 'btn', type: 'button', text: 'Add bot reply', onclick: sendBot })])]),
      settings
    ]));
    draw();
    return view;
  };

  /* ================= ES5 CHECKER ================= */
  var CK = A.checkState = { code: '', result: null, fixed: null };
  var CK_SAMPLE = "// A typical modern snippet that fails silently on Janitor\nconst msg = context.chat.last_message.toLowerCase();\nlet mood = 'neutral';\nconst words = ['happy', 'glad'];\nfor (const w of words) {\n  if (msg.includes(w)) mood = 'happy';\n}\nconst note = (m = mood) => `{{char}} notices {{user}} seems ${m}.`;\ncontext.character.personality = note();\n";
  A.views.check = function () {
    var view = h('div', { class: 'view wide' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'ES5 checker & fixer' }), h('p', { class: 'lede', text: 'Paste any Janitor script. It is parsed as strict ES5, every modern feature is pointed out in plain English, and most of them can be rewritten for you.' })])));
    var ta = h('textarea', { id: 'ckCode', rows: 18, class: 'mono', spellcheck: 'false', placeholder: 'Paste a script here' });
    ta.value = CK.code || CK_SAMPLE; CK.code = ta.value;
    ta.addEventListener('input', function () { CK.code = ta.value; });
    var res = h('div', { id: 'ckOut', style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    function check() {
      CK.result = C.check(CK.code); CK.fixed = null; drawRes();
    }
    function fix() {
      var f = C.fix(CK.code); CK.fixed = f; CK.result = C.check(CK.code); drawRes();
    }
    function jump(start, end) { try { ta.focus(); ta.setSelectionRange(start, end || start + 1); var line = CK.code.slice(0, start).split('\n').length; ta.scrollTop = Math.max(0, (line - 4) * 18); } catch (e) {} }
    function drawRes() {
      res.innerHTML = '';
      var r = CK.result; if (!r) { res.appendChild(h('p', { class: 'muted small', text: 'Press Check to analyse the script.' })); return; }
      if (r.syntaxError) {
        res.appendChild(h('div', { class: 'banner bad' }, [h('b', { text: 'Syntax error on line ' + r.syntaxError.line + ', column ' + r.syntaxError.col + '. ' }), r.syntaxError.plain || r.syntaxError.message]));
        res.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', text: 'Show me where', onclick: function () { jump(r.syntaxError.pos, r.syntaxError.pos + 1); } })));
        return;
      }
      var errs = r.issues.filter(function (i) { return i.severity === 'error'; }), warns = r.issues.filter(function (i) { return i.severity === 'warn'; });
      res.appendChild(h('div', { class: 'banner ' + (errs.length || !r.es5 ? 'bad' : warns.length ? 'warn' : 'ok'), text: errs.length || !r.es5 ? errs.length + ' thing' + (errs.length === 1 ? '' : 's') + ' Janitor may reject, ' + warns.length + ' warning' + (warns.length === 1 ? '' : 's') + '.' + (r.fixable ? ' ' + r.fixable + ' can be fixed automatically.' : '') : warns.length ? 'Valid ES5. ' + warns.length + ' warning' + (warns.length === 1 ? '' : 's') + ' worth a look.' : 'Valid ES5 with nothing to flag. Ready to paste.' }));
      var list = h('div', { class: 'items' });
      r.issues.forEach(function (i) {
        list.appendChild(h('div', { class: 'find ' + (i.severity === 'error' ? 'error' : i.severity === 'warn' ? 'warn' : 'info') }, [
          h('span', { class: 'loc', text: 'L' + i.line + ':' + i.col }),
          h('div', { class: 'fm', text: i.message }),
          h('button', { class: 'btn sm', type: 'button', text: 'Show', onclick: function () { jump(i.start, i.end); } }),
          i.fixable ? h('div', { class: 'fh', text: 'Auto-fix can rewrite this.' }) : null
        ]));
      });
      if (CK.fixed) {
        var f = CK.fixed, after = f.after;
        var left = after.issues ? after.issues.filter(function (i) { return i.severity === 'error'; }).length : 0;
        res.appendChild(h('div', { class: 'banner ' + (after.es5 && !left ? 'ok' : 'warn'), text: 'Applied ' + f.applied + ' fix' + (f.applied === 1 ? '' : 'es') + '. ' + (after.es5 && !left ? 'The result is valid ES5.' : (after.es5 ? left + ' issue' + (left === 1 ? '' : 's') + ' still need a manual fix.' : 'The result still does not parse as ES5; some constructs need a manual rewrite.')) }));
        res.appendChild(codeBox('Fixed script', f.code, { what: 'Fixed script', badge: es5Badge(f.code) }));
        res.appendChild(h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: 'Replace my code with the fix', onclick: function () { ta.value = f.code; CK.code = f.code; check(); } }),
          h('button', { class: 'btn', type: 'button', text: 'Run it in the tester', onclick: function () { TS.source = 'custom'; TS.custom = f.code; A.go('test'); } })]));
      }
      if (r.issues.length) { if (CK.fixed) res.appendChild(h('h3', { text: 'What was wrong with the original' })); res.appendChild(list); }
    }
    view.appendChild(h('div', { class: 'cols' }, [
      panel(null, [ta, h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', text: 'Check', onclick: check }), h('button', { class: 'btn', type: 'button', text: 'Auto-fix to ES5', onclick: fix }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Load this project\u2019s script', onclick: function () { ta.value = A.compiled ? A.compiled.code : ''; CK.code = ta.value; check(); } }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Test it', onclick: function () { TS.source = 'custom'; TS.custom = CK.code; A.go('test'); } })])]),
      h('div', { style: { minWidth: '0' } }, panel('Findings', res))
    ]));
    check();
    return view;
  };

  /* ================= CARD BLOCKS ================= */
  A.views.card = function () {
    var c = A.P.card;
    var view = h('div', { class: 'view wide' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Card blocks' }), h('p', { class: 'lede', text: 'Fill in the character, and copy two structured blocks for the card\u2019s Personality and Scenario fields, following the Chatbot Creation Guide layout. The script then adds to these each reply.' })])));
    function sec(title, kids) { return h('div', { class: 'f' }, [h('span', { class: 'l', text: title }), grid(kids, 'two')]); }
    var form = panel('Character', [
      sec('Identity', [fText('Name', c, 'name'), fText('Age', c, 'age'), fText('Role', c, 'role'), fText('Appearance', c, 'appearance', { area: true, rows: 2 })]),
      sec('Inside', [fText('Psychology', c, 'psych', { area: true, rows: 2 }), fText('Social style', c, 'social', { area: true, rows: 2 }), fText('Sensory details', c, 'sensory', { area: true, rows: 2 }), fText('Reply format', c, 'format', { area: true, rows: 2 })]),
      sec('Scene', [fText('Location', c, 'location'), fText('Time', c, 'timeContext'), fText('Relationship to {{user}}', c, 'userRelation'), fText('Trust level', c, 'trustLevel'), fText('Conflict level', c, 'conflictLevel')]),
      sec('Behaviour by situation', [fText('Neutral', c, 'neutral'), fText('Comfort', c, 'comfort'), fText('Affection', c, 'affection'), fText('Conflict', c, 'conflict'), fText('Teasing', c, 'teasing')]),
      sec('Flow', [fText('Triggers', c, 'triggers', { area: true, rows: 2, hint: 'Leave empty to use your States.' }), fText('Escalation', c, 'escalation'), fText('De-escalation', c, 'deescalation'), fText('Repair', c, 'repair')]),
      sec('Output', [fText('Reply length', c, 'replyLength'), fText('Tone', c, 'tone'), fText('Scene notes', c, 'sceneNotes', { area: true, rows: 2 }), fCheck('Use States as triggers', c, 'useStates')])
    ]);
    var outBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '0' } });
    function draw() {
      outBox.innerHTML = '';
      var b; try { b = J.cardBlocks(A.P); } catch (e) { outBox.appendChild(h('div', { class: 'banner bad', text: String(e.message) })); return; }
      outBox.appendChild(plainBox('Personality field', b.personality));
      outBox.appendChild(plainBox('Scenario field', b.scenario));
    }
    function plainBox(t, text) {
      var pre = h('pre', { class: 'code', style: { whiteSpace: 'pre-wrap' }, text: text });
      return h('div', { class: 'codebox' }, [h('div', { class: 'cbh' }, [h('b', { text: t }), h('span', { class: 'tag', text: text.length + ' chars' }), h('span', { class: 'spacer' }), h('button', { class: 'btn primary sm', type: 'button', text: 'Copy', onclick: function () { A.copy(text, t, pre); } })]), pre]);
    }
    draw(); A.onCompiled = draw;
    view.appendChild(h('div', { class: 'cols' }, [form, outBox]));
    return view;
  };

  /* ================= GUIDE ================= */
  A.views.guide = function () {
    var view = h('div', { class: 'view' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Guide' }), h('p', { class: 'lede', text: 'What Janitor scripts can and cannot do, as far as it is known. Janitor has published no full API reference, so confirm anything important in Test Chat.' })])));
    function sec(t, html) { var d = h('div', { class: 'prose' }); d.innerHTML = html; return panel(t, d); }
    view.appendChild(sec('How a script runs', '<ul><li>An Advanced script runs <b>once per AI reply</b>, top to bottom, then it is gone. Variables never survive to the next reply, so there is no saved state.</li><li>It reads <code>context.chat</code> and adds text to <code>context.character.personality</code> and <code>context.character.scenario</code>. Those two fields are the ones that reliably reach the model.</li><li>Always append with <code>+=</code>. Using <code>=</code> erases the character card\u2019s own text for that reply.</li><li>Several scripts can be assigned to one character. Each runs independently and the order is not guaranteed, so no script should depend on another.</li><li>The server clock is UTC. Set your UTC offset in Start &amp; settings.</li></ul>'));
    view.appendChild(sec('The context fields', '<ul><li><code>context.chat.last_message</code>: the user\u2019s latest message <span class="grade ok">confirmed</span></li><li><code>context.chat.message_count</code>: how long the chat is <span class="grade ok">confirmed</span></li><li><code>context.character.personality</code>, <code>.scenario</code>: append only <span class="grade ok">confirmed</span></li><li><code>context.chat.last_messages</code>: recent messages, as strings or objects with <code>.message</code> <span class="grade mid">community-reported</span></li><li><code>context.chat.user_name</code>, <code>context.character.name</code> <span class="grade mid">community-reported</span></li><li><code>context.character.example_dialogs</code>: may be writable <span class="grade mid">disputed</span></li><li>Changing <code>last_message</code> or <code>message_count</code> does nothing <span class="grade no">no effect</span></li></ul><p>Scripts from this builder guard every field, so a missing one never crashes them.</p>'));
    view.appendChild(sec('Why ES5', '<p>Janitor has never named its JavaScript engine. Its own template says to use <code>var</code> and regular functions, and its linked guide lists arrow functions and template strings as unsafe. Some community scripts use newer syntax successfully, so the sources disagree. ES5 works under every reading, and an unsupported feature fails <b>silently</b>: the script just does nothing. That is why the builder only writes strict ES5 and why the checker exists.</p><p>Never available: <code>fetch</code>, timers, <code>Promise</code>/<code>async</code>, <code>import</code>/<code>require</code>, the DOM, <code>localStorage</code>, <code>eval</code>.</p>'));
    view.appendChild(sec('Lorebooks', '<p>A lorebook on Janitor is a <b>script</b>, not a card field. A SillyTavern or V2 card\u2019s <code>character_book</code> is dropped on import. Either import it on the Lorebook page here (it becomes part of this script), or create a Lorebook-type script in Janitor and paste the contents of the <code>entries</code> array into its JSON editor. The Lorebook page can copy that JSON for you.</p>'));
    view.appendChild(sec('Testing on Janitor', '<ol><li>Assign the script to the character.</li><li>Open Test Chat, then Show Debug Panel.</li><li>Send a message and read the Changes tab: it shows exactly what was injected.</li><li>If the Changes tab shows your text but the reply ignores it, the script worked; the wording or the model is the issue. Put core rules in the card itself.</li><li>If nothing shows at all, paste the script into the ES5 checker here first.</li></ol>'));
    view.appendChild(sec('Tips', '<ul><li>Short, concrete lines work better than long paragraphs. The size budget keeps the highest-priority text when space runs out.</li><li>Write keys without apostrophes ("im", "dont"). Messages are matched with apostrophes removed, and whole words by default.</li><li>Use a message depth of 1 for anything the bot\u2019s own reply might repeat, or it can keep re-triggering.</li><li>"Stable" randomness gives the same roll for the same message, so a reroll does not change what happened.</li><li>Meters are rebuilt every reply from recent words and chat length. The optional "carry" setting asks the bot to repeat a tag like <code>[Trust: 12]</code>; it only works if the bot keeps doing it.</li><li>Your project is saved in this browser only. Export it from the menu to keep a copy.</li></ul>'));
    view.appendChild(sec('Keeping numbers between replies', '<p>Scripts forget everything after each reply. The <b>Stat Tracker</b> works around that: the bot ends each reply with a status line such as <code>HP: 22/30 | Gold: 15</code>, and on the next reply the script reads the newest line back from the chat. Your own message is never read for numbers, so typing <code>HP: 999</code> does not cheat, but words like \u201cdrink a potion\u201d can still change a stat. If the bot forgets to write the line, the stat falls back to its start value, so keep the instruction switched on.</p>'));
    view.appendChild(sec('Dice the bot cannot fake', '<p>Language models are poor at randomness: they favour the same numbers and reuse old rolls. Turn on <b>Dice and surprises</b> and either write <code>&lt;&lt;1d20&gt;&gt;</code> or <code>&lt;&lt;2d6+3&gt;&gt;</code> in the card (each one becomes a fresh roll every reply), or list a <b>fresh dice pool</b> like <code>1d20 x4</code> so the bot gets new numbers to use in order.</p>'));
    view.appendChild(sec('Writing that does not sound like every other bot', '<p><b>Writing Style</b> rotates a few worn-out phrases into an \u201cavoid\u201d list each reply and, when the bot\u2019s last reply used one, names it so it is not repeated. The <b>Slop check</b> page scans your own card text or pasted replies for the same phrases.</p>'));
    view.appendChild(sec('Story structure', '<p><b>Foreshadowing</b> plants quiet hints and pays them off at a set point, so twists feel earned. The <b>Story Spine helper</b> on the Story page turns seven lines (Once upon a time\u2026 Every day\u2026 Until one day\u2026 Because of that\u2026 Until finally\u2026) into phases where each part follows from the last. <b>Recap nudges</b> ask the bot to summarise every so often, which keeps early events in view in long chats.</p>'));
    view.appendChild(sec('Matching words', '<p>Keys match whole words, so <code>cat</code> never fires inside <code>category</code>. Turn on <b>Match word forms</b> in the Lorebook so <code>goblin</code> also fires on <code>goblins</code> and <code>city</code> on <code>cities</code>. Lore kept in an Obsidian vault can be pasted straight in: notes with a <code>keys:</code> or <code>aliases:</code> front-matter line become entries.</p>'));
    view.appendChild(sec('Ideas from the community', '<p>Version 2 adapts ideas (not code) from: neolaw84\u2019s janitor-ai-eval (reading state back from the chat, dice placeholders, periodic memory summaries), Tydorius\u2019s JanitorAI script templates (persistent flags, anti-omniscience, drop-in characters), dmmulroy\u2019s anti-slop (flagging low-signal patterns, here for prose and script code), Nigh\u2019s Show Me The Story (foreshadowing and continuity), jackterror\u2019s Writers Room Story Engine (Story Spine and \u201ctherefore/but\u201d causality), pixelnull\u2019s DeepLore (lore that fires without the exact word, gating, Obsidian notes), the JanitorAI Scripts Centralized Repository guidebook and aceenvw\u2019s Lorebook Compendium.</p>'));
    view.appendChild(sec('About', '<p>JanitorAI Script Builder ' + J.VERSION + '. Built from the MellowFlloww v0.2.7 module set, the Icehellionx engine patterns, the MythOS ensemble ideas and the Chatbot Creation Guide templates. Everything runs on your device; nothing is uploaded and no AI service is called.</p>'));
    return view;
  };
})(App);
