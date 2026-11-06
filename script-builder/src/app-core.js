/* JSB app core: state, autosave, DOM helpers, form fields, shell.
   Everything runs locally; nothing is ever sent anywhere. */
var App = (function () {
  'use strict';
  var JSB = window.JSB, PRESETS = window.JSB_PRESETS || [];
  var KEY = 'jsb.project.v1', THEME_KEY = 'jsb.theme', UI_KEY = 'jsb.ui';

  var A = {
    JSB: JSB, PRESETS: PRESETS,
    P: null,            /* current project */
    compiled: null,     /* last compile result */
    compileError: null,
    findings: [],
    view: 'start',
    views: {},          /* id -> render(container) */
    ui: { closed: {}, outTab: 0, lbSearch: '' },
    test: { source: 'builder', custom: '' }
  };

  /* ---------- storage (never trusted to exist) ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  A.lsGet = lsGet; A.lsSet = lsSet;

  function load() {
    var raw = lsGet(KEY), p = null;
    if (raw) { try { p = JSON.parse(raw); } catch (e) { p = null; } }
    if (!p) {
      var first = PRESETS.filter(function (x) { return x.id === 'companion'; })[0];
      p = first ? first.make() : JSB.defaultProject();
      p.meta.notes = p.meta.notes || 'Example project. Pick a different kind of bot on the Quick start page.';
      A.ui.loadedPreset = 'companion';
    }
    A.P = JSB.normalize(p);
    var u = lsGet(UI_KEY);
    if (u) { try { var o = JSON.parse(u); if (o && typeof o === 'object') { A.ui.outTab = o.outTab || 0; if (o.preset) A.ui.loadedPreset = o.preset; } } catch (e) {} }
  }
  var saveTimer = null, compileTimer = null;
  function saveNow() { lsSet(KEY, JSON.stringify(A.P)); lsSet(UI_KEY, JSON.stringify({ outTab: A.ui.outTab, preset: A.ui.loadedPreset || '' })); }

  /* ---------- compile ---------- */
  function compileNow() {
    try {
      A.compiled = JSB.compile(A.P);
      A.compileError = null;
    } catch (e) {
      A.compiled = null;
      A.compileError = String(e && e.message || e);
    }
    try { A.findings = JSB.analyze(A.P, A.compiled); } catch (e) { A.findings = []; }
    updateChrome();
    if (A.onCompiled) A.onCompiled();
  }
  A.compileNow = compileNow;

  /* Any edit lands here. */
  function changed(structural) {
    A.ui.dirty = true;
    clearTimeout(saveTimer);
    if (structural) saveNow(); else saveTimer = setTimeout(saveNow, 300);
    clearTimeout(compileTimer); compileTimer = setTimeout(compileNow, structural ? 0 : 220);
    if (structural) rerender();
  }
  A.changed = changed;

  function setProject(p) {
    A.P = JSB.normalize(p);
    A.ui.closed = {};
    saveNow(); compileNow(); renderShell(); go(A.view);
  }
  A.setProject = setProject;

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (!attrs.hasOwnProperty(k) || attrs[k] === undefined || attrs[k] === null || attrs[k] === false) continue;
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'style' && typeof v === 'object') { for (var s in v) el.style[s] = v[s]; }
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    if (kids === undefined || kids === null || kids === false) return el;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c === undefined || c === null || c === false) return;
      if (Array.isArray(c)) add(el, c);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  A.h = h; A.add = add;

  var toastTimer;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  A.toast = toast;

  /* A dialog that shows text, selected and ready to copy by hand.  Used
     whenever the clipboard or file saving is blocked, so nothing is ever lost. */
  function textModal(title, text, sub) {
    var ta = h('textarea', { rows: 14, class: 'mono', spellcheck: 'false', readonly: true, id: 'textModalBox' }); ta.value = text;
    function selAll() { try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) {} }
    var bg = h('div', { class: 'modal-bg', onclick: function (e) { if (e.target === bg) close(); } }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
        h('h3', { text: title }),
        h('p', { class: 'muted small', text: sub || 'The text is selected below. Press Ctrl+C (Cmd+C on Mac), or long-press and choose Copy on a phone.' }),
        ta,
        h('div', { class: 'row end' }, [
          h('span', { class: 'tag', text: kb(text.length) }), h('span', { class: 'spacer' }),
          h('button', { class: 'btn', type: 'button', text: 'Select all', onclick: selAll }),
          h('button', { class: 'btn', type: 'button', text: 'Try copying again', onclick: function () { tryClipboard(text, function () { toast('Copied'); }, function () { selAll(); toast('Still blocked here. Press Ctrl+C (or Cmd+C) now.'); }); } }),
          h('button', { class: 'btn primary', type: 'button', text: 'Done', onclick: close })
        ])
      ])
    ]);
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.appendChild(bg); selAll();
  }
  A.textModal = textModal;

  /* Inside the Android app, a small native bridge handles copy, save and links. */
  function bridge() { return window.AndroidApp && typeof window.AndroidApp.copyText === 'function' ? window.AndroidApp : null; }
  A.bridge = bridge;
  function tryClipboard(text, ok, fail) {
    var br = bridge();
    if (br) { try { if (br.copyText(text)) { ok(); return; } } catch (e) {} }
    function legacy() {
      var done = false;
      try {
        var ta = h('textarea', { style: { position: 'fixed', top: '0', left: '0', width: '2px', height: '2px', opacity: '0' } });
        ta.value = text; document.body.appendChild(ta); ta.focus(); ta.select();
        done = !!(document.execCommand && document.execCommand('copy'));
        document.body.removeChild(ta);
      } catch (e) { done = false; }
      if (done) ok(); else fail();
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, legacy); return; }
    } catch (e) {}
    legacy();
  }
  /* Copy must start inside the click handler.  If every way is blocked the
     text opens in a dialog instead of failing quietly. */
  function copy(text, label) {
    text = String(text === undefined || text === null ? '' : text);
    if (!text) { toast('There is nothing to copy yet.'); return; }
    tryClipboard(text, function () { toast((label || 'Text') + ' copied (' + kb(text.length) + ')'); }, function () {
      textModal('Copy ' + (label || 'text'), text, 'Your browser blocked automatic copying here, so the text is selected below. Press Ctrl+C (Cmd+C on Mac), or long-press and choose Copy.');
    });
  }
  A.copy = copy;

  /* ---------- saving files ---------- */
  var dlPromise = null;
  function downloadsNs() {
    if (!dlPromise || dlPromise.__null) {
      try {
        dlPromise = window.claude && typeof window.claude.use === 'function'
          ? Promise.resolve(window.claude.use('downloads')).then(function (x) { return x || null; }, function () { return null; })
          : Promise.resolve(null);
      } catch (e) { dlPromise = Promise.resolve(null); }
      dlPromise.then(function (x) { if (!x) dlPromise.__null = true; });
    }
    return dlPromise;
  }
  A.downloadsNs = downloadsNs;
  var HOSTED_EXT = /\.(gif|png|jpe?g|webp|txt|json|md|csv|html|svg|pdf|zip)$/i;
  /* data: string, Blob or Uint8Array.  opts.type: MIME for local saves. */
  function save(name, data, opts) {
    opts = opts || {};
    var isText = typeof data === 'string';
    function fallback(why) {
      if (isText) textModal('Save ' + name, data, (why || 'Saving files is not available here.') + ' Copy the text below into a file named ' + name + '.');
      else toast(why || 'Saving files is not available here.');
    }
    var br = bridge();
    if (br) {
      try {
        var b64;
        if (isText) b64 = window.JSBIO.b64EncodeText(data);
        else if (data instanceof Uint8Array) b64 = window.JSBIO.bytesToB64(data);
        if (b64 !== undefined) { br.saveFile(name, opts.type || 'text/plain', b64); return; }
        if (data instanceof Blob) { var fr = new FileReader(); fr.onload = function () { br.saveFile(name, opts.type || data.type || 'application/octet-stream', window.JSBIO.bytesToB64(new Uint8Array(fr.result))); }; fr.readAsArrayBuffer(data); return; }
      } catch (e) { fallback('Could not hand the file to Android (' + (e && e.message) + ').'); return; }
    }
    if (window.JSB_HOSTED) {
      if (!HOSTED_EXT.test(name)) name = name.replace(/\.[A-Za-z0-9]+$/, '') + '.txt';
      downloadsNs().then(function (ds) {
        if (!ds) { fallback('This page cannot save files in this view.'); return; }
        ds.save({ filename: name, data: data }).then(function (r) { toast(r && r.status === 'delivered' ? 'Sent ' + name : 'Saved ' + name); }, function (err) {
          var code = err && err.code;
          if (code === 'declined') toast('Save cancelled');
          else if (code === 'rate_limited') toast('A save is already waiting for your answer.');
          else fallback('The file could not be saved here (' + (code || 'unavailable') + ').');
        });
      });
      return;
    }
    try {
      var blob = data instanceof Blob ? data : new Blob([data], { type: opts.type || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: name, style: { display: 'none' } });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Saving ' + name);
    } catch (e) { fallback(); }
  }
  A.save = save;
  A.download = function (name, text, type) { save(name, text, { type: type }); };

  /* ---------- opening files ---------- */
  function readFile(file, cb) {
    var r = new FileReader();
    r.onload = function () { cb({ bytes: new Uint8Array(r.result), name: file.name, size: file.size }); };
    r.onerror = function () { toast('Could not read ' + file.name + '.'); };
    r.readAsArrayBuffer(file);
  }
  A.readFile = readFile;
  function pickFile(accept, cb) {
    var inp = h('input', { type: 'file', accept: accept || '', style: { position: 'fixed', left: '-1000px', top: '0', opacity: '0' } });
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (f) readFile(f, cb);
    });
    document.body.appendChild(inp); inp.click();
  }
  A.pickFile = pickFile;
  A.ACCEPT = '.json,.png,.js,.txt,.csv,.tsv,.md,application/json,image/png,text/plain,text/csv,text/javascript';

  /* A two-step button: first click arms it, second click acts. */
  function confirmBtn(label, armedLabel, cls, act) {
    var b = h('button', { class: 'btn ' + (cls || ''), type: 'button', text: label });
    var t;
    b.addEventListener('click', function () {
      if (b.classList.contains('armed')) { clearTimeout(t); b.classList.remove('armed'); b.textContent = label; act(); return; }
      b.classList.add('armed'); b.textContent = armedLabel;
      t = setTimeout(function () { b.classList.remove('armed'); b.textContent = label; }, 3500);
    });
    return b;
  }
  A.confirmBtn = confirmBtn;

  /* ---------- form fields ---------- */
  var fid = 0;
  function nid() { return 'f' + (++fid); }
  function label(text, extra) { return h('span', { class: 'l' }, [text, extra || null]); }
  function wrap(lbl, input, o, id) {
    o = o || {};
    return h('label', { class: 'f' + (o.span ? ' span' : ''), for: id }, [label(lbl, o.badge), input, o.hint ? h('span', { class: 'hint', text: o.hint }) : null]);
  }
  /* text / textarea */
  function fText(lbl, obj, key, o) {
    o = o || {};
    var id = o.id || nid();
    var v = obj[key] === undefined || obj[key] === null ? '' : obj[key];
    var el = o.area
      ? h('textarea', { id: id, rows: o.rows || 3, class: o.mono ? 'mono' : null, placeholder: o.ph || '', spellcheck: o.mono ? 'false' : null })
      : h('input', { id: id, type: 'text', class: o.mono ? 'mono' : null, placeholder: o.ph || '', spellcheck: o.mono ? 'false' : null });
    el.value = Array.isArray(v) ? v.join(o.area ? '\n' : ', ') : String(v);
    el.addEventListener('input', function () { obj[key] = el.value; if (o.onInput) o.onInput(el.value); changed(false); });
    if (o.onBlur) el.addEventListener('change', o.onBlur);
    return wrap(lbl, el, o, id);
  }
  function fNum(lbl, obj, key, o) {
    o = o || {};
    var id = nid();
    var el = h('input', { id: id, type: 'number', step: o.step || 'any', min: o.min, max: o.max, placeholder: o.ph || '' });
    el.value = obj[key] === undefined || obj[key] === null ? '' : obj[key];
    el.addEventListener('input', function () {
      var n = parseFloat(el.value);
      obj[key] = el.value === '' ? (o.blank !== undefined ? o.blank : 0) : (isNaN(n) ? 0 : n);
      if (o.onInput) o.onInput(obj[key]);
      changed(!!o.structural);
    });
    return wrap(lbl, el, o, id);
  }
  function fCheck(lbl, obj, key, o) {
    o = o || {};
    var id = nid();
    var el = h('input', { id: id, type: 'checkbox' }); el.checked = !!obj[key];
    el.addEventListener('change', function () { obj[key] = el.checked; if (o.onChange) o.onChange(el.checked); changed(!!o.structural); });
    return h('label', { class: 'chk' + (o.span ? ' span' : ''), for: id }, [el, h('span', null, [lbl, o.hint ? h('span', { class: 'hint', text: o.hint }) : null])]);
  }
  function fSelect(lbl, obj, key, opts, o) {
    o = o || {};
    var id = nid();
    var el = h('select', { id: id });
    opts.forEach(function (op) {
      var v = Array.isArray(op) ? op[0] : op, t = Array.isArray(op) ? op[1] : op;
      el.appendChild(h('option', { value: v, text: t }));
    });
    el.value = obj[key] === undefined ? '' : String(obj[key]);
    if (el.value !== String(obj[key]) && opts.length) { /* unknown value: keep it visible */
      if (obj[key] !== undefined && obj[key] !== '') { el.appendChild(h('option', { value: obj[key], text: String(obj[key]) })); el.value = obj[key]; }
    }
    el.addEventListener('change', function () {
      var v = el.value;
      if (o.numeric) v = parseFloat(v);
      obj[key] = v; if (o.onChange) o.onChange(v); changed(!!o.structural);
    });
    return wrap(lbl, el, o, id);
  }
  function fRange(lbl, obj, key, min, max, step, o) {
    o = o || {};
    var id = nid();
    var em = h('em', { text: fmtNum(obj[key]) + (o.unit || '') });
    var el = h('input', { id: id, type: 'range', min: min, max: max, step: step });
    el.value = obj[key];
    el.addEventListener('input', function () { obj[key] = parseFloat(el.value); em.textContent = fmtNum(obj[key]) + (o.unit || ''); if (o.onInput) o.onInput(obj[key]); changed(false); });
    o.badge = em;
    return wrap(lbl, el, o, id);
  }
  function fSwitch(lbl, obj, key, o) {
    o = o || {};
    var id = nid();
    var el = h('input', { id: id, type: 'checkbox', role: 'switch' }); el.checked = !!obj[key];
    el.addEventListener('change', function () { obj[key] = el.checked; if (o.onChange) o.onChange(el.checked); changed(o.structural !== false); });
    return h('label', { class: 'switch', for: id }, [el, h('span', { class: 'tr' }), h('span', { text: lbl })]);
  }
  function fmtNum(v) { var n = parseFloat(v); if (isNaN(n)) return '0'; return Math.round(n * 100) / 100 + ''; }
  A.fText = fText; A.fNum = fNum; A.fCheck = fCheck; A.fSelect = fSelect; A.fRange = fRange; A.fSwitch = fSwitch;

  var TARGETS = [['scenario', 'Scenario'], ['personality', 'Personality']];
  A.TARGETS = TARGETS;
  function fTarget(obj, o) { return fSelect('Adds to', obj, 'target', TARGETS, Object.assign({ hint: 'Scenario for situation and world; personality for how the character behaves.' }, o || {})); }
  A.fTarget = fTarget;

  /* ---------- repeater ---------- */
  var uidN = 0;
  function oid(o) { if (!o.__k) Object.defineProperty(o, '__k', { value: 'o' + (++uidN), enumerable: false }); return o.__k; }
  /* opts: items, title(item,i), sub(item,i), body(item,i)->node[], make(), addLabel, empty, collapsible, startClosed, filter(item) */
  function repeater(opts) {
    var box = h('div', { class: 'items' });
    var items = opts.items;
    var shown = 0;
    items.forEach(function (it, i) {
      if (opts.filter && !opts.filter(it)) return;
      shown++;
      var k = oid(it);
      var closed = opts.collapsible && (A.ui.closed[k] === undefined ? !!opts.startClosed : A.ui.closed[k]);
      var titleEl = h('div', { class: 'it', title: opts.collapsible ? 'Click to open or close' : null }, [opts.title(it, i), opts.sub ? h('small', { text: opts.sub(it, i) }) : null]);
      var card = h('div', { class: 'item' + (closed ? ' closed' : '') + (it.enabled === false ? ' off' : '') });
      if (opts.collapsible) titleEl.addEventListener('click', function () { A.ui.closed[k] = !card.classList.contains('closed'); card.classList.toggle('closed'); });
      var head = h('div', { class: 'ih' }, [
        opts.collapsible ? h('button', { class: 'btn ghost iconbtn', type: 'button', 'aria-label': 'Open or close', text: closed ? '\u25b8' : '\u25be', onclick: function (e) { A.ui.closed[k] = !card.classList.contains('closed'); card.classList.toggle('closed'); e.currentTarget.textContent = card.classList.contains('closed') ? '\u25b8' : '\u25be'; } }) : null,
        titleEl,
        opts.extraHead ? opts.extraHead(it, i) : null,
        h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'Move up', 'aria-label': 'Move up', text: '\u2191', disabled: i === 0, onclick: function () { move(items, i, -1); } }),
        h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'Move down', 'aria-label': 'Move down', text: '\u2193', disabled: i === items.length - 1, onclick: function () { move(items, i, 1); } }),
        opts.noDup ? null : h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate', text: '\u29c9', onclick: function () {
          var c = JSON.parse(JSON.stringify(it)); if (opts.onDup) opts.onDup(c); items.splice(i + 1, 0, c); changed(true);
        } }),
        h('button', { class: 'btn ghost iconbtn danger', type: 'button', title: 'Delete', 'aria-label': 'Delete', text: '\u2715', onclick: function () { items.splice(i, 1); changed(true); toast('Deleted'); } })
      ]);
      card.appendChild(head);
      card.appendChild(add(h('div', { class: 'ib' }), opts.body(it, i)));
      box.appendChild(card);
    });
    if (!shown) box.appendChild(h('div', { class: 'empty', text: opts.empty || 'Nothing here yet.' }));
    if (opts.make) box.appendChild(h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: '+ ' + (opts.addLabel || 'Add'), onclick: function () {
      var n = opts.make(); items.push(n); if (opts.collapsible) A.ui.closed[oid(n)] = false; changed(true);
    } })]));
    return box;
  }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; changed(true); }
  A.repeater = repeater;

  function grid(kids, cls) { return h('div', { class: 'grid' + (cls ? ' ' + cls : '') }, kids); }
  function panel(title, kids, sub) { return h('section', { class: 'panel' }, [title ? h('h3', null, title) : null, sub ? h('p', { class: 'sub', text: sub }) : null, kids]); }
  A.grid = grid; A.panel = panel;

  /* ---------- size / status ---------- */
  function codeSize() { return A.compiled ? A.compiled.code.length : 0; }
  function kb(n) { return n < 1000 ? n + ' B' : (n / 1000).toFixed(1) + ' KB'; }
  A.kb = kb;
  function countFind(level, mod) { return A.findings.filter(function (f) { return f.level === level && (!mod || f.module === mod); }).length; }
  A.countFind = countFind;

  function updateChrome() {
    var m = document.getElementById('meter');
    if (m) {
      var n = codeSize(), sc = A.compiled ? A.compiled.scripts.length : 0;
      var errs = countFind('error');
      m.innerHTML = '';
      add(m, [h('span', { class: 'dot' + (A.compileError || errs ? ' bad' : n > 60000 || countFind('warn') ? ' warn' : '') }),
        A.compileError ? 'Build failed' : kb(n) + ' \u00b7 ' + sc + ' script' + (sc === 1 ? '' : 's') + (A.compiled ? ' \u00b7 ' + A.compiled.modules.length + ' modules' : '')]);
    }
    A.JSB.MODULES.forEach(function (mod) {
      var st = document.querySelector('[data-st="' + mod.id + '"]');
      if (st) st.className = 'st' + (A.P.modules[mod.id].enabled ? ' on' : '');
    });
    var c = document.querySelector('[data-cnt="analyze"]');
    if (c) {
      var e = countFind('error'), w = countFind('warn');
      c.textContent = e ? e + '' : w ? w + '' : '';
      c.className = 'cnt' + (e ? ' bad' : w ? ' warn' : '');
    }
    var title = document.getElementById('projTitle');
    if (title && document.activeElement !== title) title.value = A.P.meta.title;
    /* Simple mode lists only the features that are on, so refresh the menu when that changes. */
    var sig = A.simple + ':' + A.JSB.MODULE_IDS.filter(function (id) { return A.P.modules[id].enabled; }).join(',');
    if (sig !== A.ui.navSig) { A.ui.navSig = sig; renderShell(); markNav(); }
  }
  A.updateChrome = updateChrome;

  /* ---------- theme ---------- */
  function applyTheme(t) {
    var r = document.documentElement;
    if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
    var b = document.getElementById('themeBtn');
    if (b) b.textContent = t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto theme';
  }
  function cycleTheme() {
    var cur = lsGet(THEME_KEY) || 'auto', next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    lsSet(THEME_KEY, next); A.theme = next; applyTheme(next);
  }

  /* ---------- shell ---------- */
  var NAV = [
    { h: 'Build' },
    { id: 'start', ico: '\u2302', name: 'Start & settings' },
    { id: 'io', ico: '\u21c5', name: 'Import & export' }
  ];
  function navList() {
    if (A.simple) {
      var s = [{ h: 'Make' }, { id: 'quick', ico: '\u2605', name: 'Quick start' }];
      A.JSB.MODULES.forEach(function (m) { if (A.P.modules[m.id].enabled) s.push({ id: 'mod-' + m.id, ico: m.icon, name: (A.FRIENDLY && A.FRIENDLY[m.id] ? A.FRIENDLY[m.id][0] : m.name), mod: m.id }); });
      s.push({ h: 'Test & share' });
      s.push({ id: 'chat', ico: '\u2709', name: 'Test chat' });
      s.push({ id: 'output', ico: '\u2398', name: 'Get the script' });
      s.push({ id: 'io', ico: '\u21c5', name: 'Import & export' });
      s.push({ h: 'Help' });
      s.push({ id: 'slop', ico: '\u270d', name: 'Slop check' });
      s.push({ id: 'guide', ico: '?', name: 'Guide' });
      return s;
    }
    var list = [{ h: 'Build' }, { id: 'quick', ico: '\u2605', name: 'Quick start' }].concat(NAV.slice(1));
    A.JSB.MODULES.forEach(function (m) { list.push({ id: 'mod-' + m.id, ico: m.icon, name: m.name, mod: m.id }); });
    list.push({ h: 'Check & test' });
    list.push({ id: 'output', ico: '\u2398', name: 'Script output' });
    list.push({ id: 'analyze', ico: '\u2691', name: 'Analyzer', cnt: 'analyze' });
    list.push({ id: 'test', ico: '\u25b6', name: 'Tester & fuzz' });
    list.push({ id: 'chat', ico: '\u2709', name: 'Chat simulator' });
    list.push({ id: 'check', ico: '\u2714', name: 'ES5 checker & fixer' });
    list.push({ h: 'Character' });
    list.push({ id: 'card', ico: '\u270e', name: 'Card blocks' });
    list.push({ id: 'slop', ico: '\u270d', name: 'Slop check' });
    list.push({ id: 'guide', ico: '?', name: 'Guide' });
    return list;
  }
  function renderShell() {
    var side = document.getElementById('side');
    side.innerHTML = '';
    navList().forEach(function (n) {
      if (n.h) { side.appendChild(h('h4', { text: n.h })); return; }
      side.appendChild(h('button', { class: 'nav', type: 'button', 'data-view': n.id, onclick: function () { go(n.id); } }, [
        h('span', { class: 'ico', 'aria-hidden': 'true', text: n.ico }), h('span', { class: 'lbl', text: n.name }),
        n.mod ? h('span', { class: 'st', 'data-st': n.mod, title: 'On or off' }) : null,
        n.cnt ? h('span', { class: 'cnt', 'data-cnt': n.cnt }) : null
      ]));
    });
    updateChrome();
  }
  A.renderShell = renderShell;
  function markNav() {
    [].forEach.call(document.querySelectorAll('.nav'), function (b) {
      if (b.getAttribute('data-view') === A.view) { b.setAttribute('aria-current', 'page'); if (b.scrollIntoView && window.innerWidth <= 860) { try { b.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} } }
      else b.removeAttribute('aria-current');
    });
  }

  A.markNav = function () { markNav(); };
  function go(id, keepScroll) {
    if (!A.views[id] && !/^mod-/.test(id)) id = 'quick';
    A.view = id;
    try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch (e) {}
    rerender(keepScroll);
    markNav();
    if (!keepScroll) { try { window.scrollTo(0, 0); } catch (e) {} }
  }
  A.go = go;

  function rerender() {
    var main = document.getElementById('main');
    var y = window.scrollY;
    A.onCompiled = null;
    main.innerHTML = '';
    var v = A.view, node;
    try {
      if (/^mod-/.test(v)) node = A.renderModule(v.slice(4));
      else node = A.views[v]();
    } catch (e) {
      node = h('div', { class: 'banner bad', text: 'This page hit an error: ' + (e && e.message) + '. Your project is safe; try another page.' });
      if (window.console) console.error(e);
    }
    main.appendChild(node);
    try { window.scrollTo(0, y); } catch (e) {}
  }
  A.rerender = rerender;

  function openMenu(btn) {
    var existing = document.querySelector('.menu .pop');
    if (existing) { existing.parentNode.removeChild(existing); return; }
    var IO = window.JSBIO, slug = A.JSB.slug(A.P.meta.title || 'project');
    var pop = h('div', { class: 'pop', role: 'menu' }, [
      h('button', { type: 'button', text: 'Import a file\u2026', onclick: function () { close(); pickFile(A.ACCEPT, A.openImport); } }),
      h('button', { type: 'button', text: 'Paste to import\u2026', onclick: function () { close(); pasteModal('Paste to import', 'Paste a project code, project JSON, character card, lorebook (any common format), CSV, plain-text lore, or a Janitor script.', function (t) { A.openImport({ text: t }); }); } }),
      h('button', { type: 'button', text: 'All import & export options', onclick: function () { close(); go('io'); } }),
      h('hr'),
      h('button', { type: 'button', text: 'Save project file (.json)', onclick: function () { close(); save(slug + '.jsb.json', IO.projectJSON(A.P), { type: 'application/json' }); } }),
      h('button', { type: 'button', text: 'Copy project code', onclick: function () { close(); copy(IO.projectCode(A.P), 'Project code'); } }),
      h('button', { type: 'button', text: 'Save script (.js)', onclick: function () { close(); if (A.compiled) save(slug + '.js', A.scriptCode(), { type: 'text/javascript' }); } }),
      h('hr'),
      h('button', { type: 'button', text: 'Start a blank project', onclick: function () { close(); go('start'); toast('Pick "Blank project" under Presets'); } })
    ]);
    function close() { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', esc); }
    function outside(e) { if (!pop.contains(e.target) && e.target !== btn) close(); }
    function esc(e) { if (e.key === 'Escape') close(); }
    btn.parentNode.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', outside, true); document.addEventListener('keydown', esc); }, 0);
  }
  /* The script as it should be copied or saved (with re-import data if asked). */
  A.scriptCode = function (index) {
    if (!A.compiled) return '';
    return window.JSBIO.scriptText(A.P, A.compiled, { embed: !!A.P.settings.embed, index: index });
  };
  function importProject(text) { A.openImport({ text: text }); }
  A.importProject = importProject;

  function pasteModal(title, sub, cb, initial) {
    var ta = h('textarea', { rows: 12, class: 'mono', spellcheck: 'false', id: 'pasteBox' }); ta.value = initial || '';
    var bg = h('div', { class: 'modal-bg', onclick: function (e) { if (e.target === bg) close(); } }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
        h('h3', { text: title }), sub ? h('p', { class: 'muted small', text: sub }) : null, ta,
        h('div', { class: 'row end' }, [h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close }), h('button', { class: 'btn primary', type: 'button', text: 'Import', onclick: function () { var v = ta.value; close(); cb(v); } })])
      ])
    ]);
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.appendChild(bg); ta.focus();
  }
  A.pasteModal = pasteModal;

  function boot() {
    A.theme = lsGet(THEME_KEY) || 'auto';
    applyTheme(A.theme);
    load();
    var title = document.getElementById('projTitle');
    title.value = A.P.meta.title;
    title.addEventListener('input', function () { A.P.meta.title = title.value; changed(false); });
    document.getElementById('themeBtn').addEventListener('click', cycleTheme);
    document.getElementById('menuBtn').addEventListener('click', function (e) { openMenu(e.currentTarget); });
    document.getElementById('copyBtn').addEventListener('click', function () {
      if (!A.compiled) { toast('The script did not build. Open the Analyzer.'); return; }
      if (A.compiled.scripts.length > 1) { go('output'); toast('Split mode: copy each script from its tab'); return; }
      copy(A.scriptCode(), 'Script');
    });
    var top = document.querySelector('.top');
    function topH() { if (top) document.documentElement.style.setProperty('--topH', top.offsetHeight + 'px'); }
    window.addEventListener('resize', topH); topH();
    window.addEventListener('pagehide', saveNow);
    /* Dropping a file anywhere imports it instead of navigating away. */
    window.addEventListener('dragover', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', function (e) {
      document.body.classList.remove('dragging');
      if (!e.dataTransfer) return;
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); readFile(f, A.openImport); return; }
      var t = e.dataTransfer.getData && e.dataTransfer.getData('text');
      if (t && !(e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName))) { e.preventDefault(); A.openImport({ text: t }); }
    });
    if (window.JSB_HOSTED) downloadsNs();
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    compileNow();
    if (A.initEasy) A.initEasy();
    A.ui.dirty = false;
    renderShell();
    var hsh = (location.hash || '').replace(/^#/, '');
    go(hsh || 'quick');
    window.addEventListener('hashchange', function () { var x = (location.hash || '').replace(/^#/, ''); if (x && x !== A.view) go(x); });
  }
  A.boot = boot;
  /* Called by the Android app. Back: close the menu, then go to Quick start, then leave. */
  window.JSB_back = function () {
    if (document.querySelector('.modal-bg')) { var m = document.querySelector('.modal-bg'); m.parentNode.removeChild(m); return true; }
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return true; }
    if (A.view !== 'quick') { go('quick'); return true; }
    return false;
  };
  window.JSB_import = function (name, b64) {
    try { A.openImport({ bytes: window.JSBIO.b64ToBytes(b64), name: name }); } catch (e) { toast('Could not open ' + name + ': ' + (e && e.message)); }
  };
  window.JSB_saved = function (name, ok) { toast(ok ? 'Saved ' + name : 'Save cancelled'); };
  return A;
})();
