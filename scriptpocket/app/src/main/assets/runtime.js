/* ScriptPocket userscript runtime.
 * The app fills in the four markers below and injects one copy of this file
 * per enabled script, so a syntax error in one script can't break the others.
 * The user's code sits in its own function at the bottom, outside this
 * closure, so it can't see the bridge token or any of the helpers here. */
(function (USER, META, TOKEN, KEY) {
  var w = window;
  var B = w.ScriptPocketBridge;
  if (!B || !META) return;
  var ID = META.id;
  var isTop = false;
  try { isTop = w.top === w; } catch (e) { isTop = false; }
  if (META.noframes && !isTop) return;

  /* ---------- URL matching ---------- */

  function escapeRe(s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }
  // Glob to regex source: '*' means anything, everything else is literal.
  function wild(s) { return s.split('*').map(escapeRe).join('.*'); }

  function globToRe(glob) {
    if (glob.length > 2 && glob.charAt(0) === '/' && glob.lastIndexOf('/') > 0) {
      var end = glob.lastIndexOf('/');
      try { return new RegExp(glob.slice(1, end), glob.slice(end + 1)); } catch (e) { /* not a regex */ }
    }
    return new RegExp('^' + wild(glob) + '$', 'i');
  }

  function testGlob(glob, url) {
    try { return globToRe(glob).test(url); } catch (e) { return false; }
  }

  function testMatch(pattern, url) {
    if (pattern === '<all_urls>') return /^(https?|file):/i.test(url);
    if (pattern === '*') return true;
    var m = /^(\*|[a-z][a-z0-9+.\-]*):\/\/([^\/]*)(\/.*)?$/i.exec(pattern);
    if (!m) return testGlob(pattern, url);
    var u;
    try { u = new URL(url); } catch (e) { return false; }
    var scheme = m[1].toLowerCase(), host = m[2].toLowerCase(), path = m[3] || '/*';
    var proto = u.protocol.replace(':', '').toLowerCase();
    if (scheme === '*') { if (proto !== 'http' && proto !== 'https') return false; }
    else if (scheme !== proto) return false;
    host = host.replace(/:\d+$/, '').replace(/:\*$/, '');
    var hn = u.hostname.toLowerCase();
    if (host !== '*' && host !== '') {
      if (host.indexOf('*.') === 0) {
        var base = host.slice(2);
        if (hn !== base && hn.slice(-(base.length + 1)) !== '.' + base) return false;
      } else if (host !== hn) return false;
    }
    var re = new RegExp('^' + wild(path) + '$');
    return re.test(u.pathname + u.search) || re.test(u.pathname);
  }

  function shouldRun(url) {
    var i;
    for (i = 0; i < META.excludes.length; i++) if (testGlob(META.excludes[i], url)) return false;
    for (i = 0; i < META.excludeMatches.length; i++) if (testMatch(META.excludeMatches[i], url)) return false;
    if (!META.matches.length && !META.includes.length) return true;
    for (i = 0; i < META.matches.length; i++) if (testMatch(META.matches[i], url)) return true;
    for (i = 0; i < META.includes.length; i++) if (testGlob(META.includes[i], url)) return true;
    return false;
  }

  if (!shouldRun(String(location.href))) return;

  // Fallback injection can fire more than once per page.
  var flag = '__sp_' + KEY + '_' + ID;
  try {
    if (w[flag]) return;
    Object.defineProperty(w, flag, { value: true });
  } catch (e) { return; }

  /* ---------- helpers ---------- */

  function call(fn, self, args) {
    if (typeof fn !== 'function') return;
    try { return fn.apply(self, args || []); }
    catch (e) { logLine('error', 'callback failed: ' + errText(e)); }
  }
  function errText(e) { return e && e.stack ? String(e.stack) : String(e); }
  function logLine(level, msg) {
    try { B.log(TOKEN, ID, level, String(msg)); } catch (e) { /* bridge gone */ }
  }
  function absUrl(u) {
    try { return new URL(String(u), location.href).href; } catch (e) { return String(u); }
  }
  function b64ToBytes(b64) {
    var bin = atob(b64 || ''), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8(bytes) {
    try { return new TextDecoder('utf-8').decode(bytes); }
    catch (e) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
  }
  function whenRoot(fn) {
    var root = document.head || document.documentElement;
    if (root) { fn(root); return; }
    var mo = new MutationObserver(function () {
      var r = document.head || document.documentElement;
      if (r) { mo.disconnect(); fn(r); }
    });
    mo.observe(document, { childList: true, subtree: true });
  }

  /* ---------- GM_info ---------- */

  var GM_info = {
    script: {
      name: META.name, namespace: META.namespace, version: META.version,
      description: META.description, author: META.author,
      matches: META.matches.slice(), includes: META.includes.slice(),
      excludes: META.excludes.slice(), grant: META.grants.slice(),
      'run-at': META.runAt, resources: Object.keys(META.resources)
    },
    scriptMetaStr: META.metaStr,
    scriptHandler: 'ScriptPocket',
    version: META.appVersion
  };

  /* ---------- storage ---------- */

  var listeners = {}, listenerSeq = 0;

  function GM_getValue(key, def) {
    var raw = B.getValue(TOKEN, ID, String(key));
    if (raw === null || raw === undefined || raw === '') return def;
    try { return JSON.parse(raw); } catch (e) { return def; }
  }
  function fire(key, oldV, newV) {
    for (var k in listeners) {
      if (listeners[k].key === key) call(listeners[k].fn, null, [key, oldV, newV, false]);
    }
  }
  function GM_setValue(key, value) {
    key = String(key);
    var old = GM_getValue(key);
    var json = JSON.stringify(value === undefined ? null : value);
    B.setValue(TOKEN, ID, key, json);
    fire(key, old, value);
  }
  function GM_deleteValue(key) {
    key = String(key);
    var old = GM_getValue(key);
    B.deleteValue(TOKEN, ID, key);
    fire(key, old, undefined);
  }
  function GM_listValues() {
    try { return JSON.parse(B.listValues(TOKEN, ID)); } catch (e) { return []; }
  }
  function GM_addValueChangeListener(key, fn) {
    var id = ++listenerSeq;
    listeners[id] = { key: String(key), fn: fn };
    return id;
  }
  function GM_removeValueChangeListener(id) { delete listeners[id]; }

  /* ---------- network ---------- */

  function GM_xmlhttpRequest(d) {
    d = d || {};
    var headers = {};
    if (d.headers) for (var h in d.headers) headers[h] = String(d.headers[h]);
    var data = d.data;
    if (data !== undefined && data !== null && typeof data !== 'string') {
      if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
        data = data.toString();
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      } else if (typeof data === 'object') {
        try { data = JSON.stringify(data); } catch (e) { data = String(data); }
      } else data = String(data);
    }
    var rt = String(d.responseType || '').toLowerCase();
    var details = {
      method: String(d.method || 'GET').toUpperCase(),
      url: absUrl(d.url),
      headers: headers,
      data: data === undefined || data === null ? null : data,
      timeout: d.timeout || 0,
      binary: rt === 'arraybuffer' || rt === 'blob',
      overrideMimeType: d.overrideMimeType || null,
      user: d.user || null,
      password: d.password || null,
      anonymous: !!d.anonymous
    };
    var rid = B.xhrStart(TOKEN, ID, JSON.stringify(details));
    var done = false, timer = null;

    function build(r) {
      var text = r.text || '';
      var resp = {
        readyState: 4, status: r.status || 0, statusText: r.statusText || '',
        responseHeaders: r.headers || '', finalUrl: r.finalUrl || details.url,
        responseText: text, response: text, context: d.context
      };
      if (r.base64 !== undefined && r.base64 !== null) {
        var bytes = b64ToBytes(r.base64);
        resp.responseText = utf8(bytes);
        resp.response = rt === 'blob'
          ? new Blob([bytes], { type: r.contentType || 'application/octet-stream' })
          : bytes.buffer;
      } else if (rt === 'json') {
        try { resp.response = JSON.parse(text); } catch (e) { resp.response = undefined; }
      } else if (rt === 'document') {
        try { resp.response = new DOMParser().parseFromString(text, r.contentType && r.contentType.indexOf('xml') >= 0 ? 'text/xml' : 'text/html'); }
        catch (e) { resp.response = undefined; }
      }
      return resp;
    }

    function finish(r) {
      var resp = build(r);
      if (r.timeout) call(d.ontimeout, resp, [resp]);
      else if (r.error) { resp.error = r.error; call(d.onerror, resp, [resp]); }
      else {
        call(d.onreadystatechange, resp, [resp]);
        call(d.onprogress, resp, [{ loaded: resp.responseText.length, total: resp.responseText.length, lengthComputable: true }]);
        call(d.onload, resp, [resp]);
      }
      call(d.onloadend, resp, [resp]);
    }

    function poll() {
      if (done) return;
      var r = B.xhrPoll(TOKEN, rid);
      if (r) {
        done = true;
        var parsed;
        try { parsed = JSON.parse(r); } catch (e) { parsed = { error: 'bad response from app' }; }
        finish(parsed);
      } else timer = setTimeout(poll, 30);
    }
    if (!rid) {
      done = true;
      setTimeout(function () { finish({ error: 'request refused' }); }, 0);
    } else {
      call(d.onloadstart, null, [{}]);
      timer = setTimeout(poll, 10);
    }
    return {
      abort: function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        B.xhrAbort(TOKEN, rid);
        call(d.onabort, null, [{ status: 0, readyState: 4, context: d.context }]);
      }
    };
  }

  /* ---------- page helpers ---------- */

  function GM_addStyle(css) {
    var el = document.createElement('style');
    el.textContent = String(css);
    whenRoot(function (root) { root.appendChild(el); });
    return el;
  }
  function GM_addElement(parent, tag, attrs) {
    if (typeof parent === 'string') { attrs = tag; tag = parent; parent = null; }
    var el = document.createElement(tag);
    if (attrs) for (var a in attrs) {
      if (a === 'textContent') el.textContent = attrs[a];
      else el.setAttribute(a, attrs[a]);
    }
    if (parent) parent.appendChild(el);
    else whenRoot(function (root) { (document.body && tag !== 'style' && tag !== 'link' ? document.body : root).appendChild(el); });
    return el;
  }

  var menu = {}, menuSeq = 0;
  if (isTop) {
    try {
      Object.defineProperty(w, '__spm_' + KEY + '_' + ID, {
        value: function (cmd) { if (menu[cmd]) call(menu[cmd], null, []); }
      });
    } catch (e) { /* already defined */ }
  }
  function GM_registerMenuCommand(name, fn) {
    var id = 'c' + (++menuSeq);
    menu[id] = fn;
    if (isTop) B.registerMenu(TOKEN, ID, id, String(name));
    return id;
  }
  function GM_unregisterMenuCommand(id) {
    delete menu[id];
    if (isTop) B.unregisterMenu(TOKEN, ID, String(id));
  }

  function GM_notification(details, title, image, onclick) {
    var text = typeof details === 'object' && details ? details.text : details;
    var t = typeof details === 'object' && details ? details.title : title;
    B.notify(TOKEN, ID, (t ? t + ': ' : '') + String(text || ''));
  }
  function GM_setClipboard(data) { B.setClipboard(TOKEN, ID, String(data)); }
  function GM_openInTab(url) {
    B.openInTab(TOKEN, ID, absUrl(url));
    return { close: function () {}, closed: false };
  }
  function GM_log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
    }
    try { console.log.apply(console, ['[' + META.name + ']'].concat([].slice.call(arguments))); } catch (e) { /* no console */ }
    logLine('log', parts.join(' '));
  }
  function GM_getResourceText(name) {
    var r = META.resources[name];
    return r ? utf8(b64ToBytes(r.b64)) : null;
  }
  function GM_getResourceURL(name) {
    var r = META.resources[name];
    return r ? 'data:' + (r.mime || 'application/octet-stream') + ';base64,' + r.b64 : null;
  }
  function GM_download(details, name) {
    var url = typeof details === 'string' ? details : details && details.url;
    if (url) B.openInTab(TOKEN, ID, absUrl(url));
  }

  function wrap(fn) {
    return function () {
      var args = arguments;
      return new Promise(function (resolve, reject) {
        try { resolve(fn.apply(null, args)); } catch (e) { reject(e); }
      });
    };
  }

  var GM = {
    info: GM_info,
    getValue: wrap(GM_getValue),
    setValue: wrap(GM_setValue),
    deleteValue: wrap(GM_deleteValue),
    listValues: wrap(GM_listValues),
    addValueChangeListener: wrap(GM_addValueChangeListener),
    removeValueChangeListener: wrap(GM_removeValueChangeListener),
    xmlHttpRequest: function (d) {
      d = d || {};
      var copy = {};
      for (var k in d) copy[k] = d[k];
      var req;
      var p = new Promise(function (resolve, reject) {
        copy.onload = function (r) { call(d.onload, r, [r]); resolve(r); };
        copy.onerror = function (r) { call(d.onerror, r, [r]); reject(r); };
        copy.ontimeout = function (r) { call(d.ontimeout, r, [r]); reject(r); };
        copy.onabort = function (r) { call(d.onabort, r, [r]); reject(r); };
        req = GM_xmlhttpRequest(copy);
      });
      p.abort = function () { req.abort(); };
      return p;
    },
    addStyle: wrap(GM_addStyle),
    addElement: wrap(GM_addElement),
    registerMenuCommand: wrap(GM_registerMenuCommand),
    unregisterMenuCommand: wrap(GM_unregisterMenuCommand),
    notification: wrap(GM_notification),
    setClipboard: wrap(GM_setClipboard),
    openInTab: wrap(GM_openInTab),
    log: wrap(GM_log),
    getResourceText: wrap(GM_getResourceText),
    getResourceUrl: wrap(GM_getResourceURL),
    download: wrap(GM_download)
  };

  /* ---------- run ---------- */

  function go() {
    try { B.ran(TOKEN, ID, String(location.href)); } catch (e) { /* bridge gone */ }
    try {
      USER.call(w, w, GM, GM_info,
        GM_getValue, GM_setValue, GM_deleteValue, GM_listValues,
        GM_addValueChangeListener, GM_removeValueChangeListener,
        GM_xmlhttpRequest, GM_addStyle, GM_addElement,
        GM_registerMenuCommand, GM_unregisterMenuCommand,
        GM_notification, GM_setClipboard, GM_openInTab, GM_log,
        GM_getResourceText, GM_getResourceURL, GM_download);
    } catch (e) {
      try { console.error('[ScriptPocket] ' + META.name + ' crashed:', e); } catch (e2) { /* no console */ }
      logLine('error', 'crashed: ' + errText(e));
    }
  }

  var runAt = META.runAt;
  if (runAt === 'document-start') {
    go();
  } else if (runAt === 'document-body') {
    if (document.body) go();
    else {
      var mo = new MutationObserver(function () {
        if (document.body) { mo.disconnect(); go(); }
      });
      mo.observe(document.documentElement || document, { childList: true, subtree: true });
    }
  } else {
    var later = runAt === 'document-end' ? go : function () { setTimeout(go, 0); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function once() {
        document.removeEventListener('DOMContentLoaded', once);
        later();
      });
    } else later();
  }
})(function (unsafeWindow, GM, GM_info,
  GM_getValue, GM_setValue, GM_deleteValue, GM_listValues,
  GM_addValueChangeListener, GM_removeValueChangeListener,
  GM_xmlhttpRequest, GM_addStyle, GM_addElement,
  GM_registerMenuCommand, GM_unregisterMenuCommand,
  GM_notification, GM_setClipboard, GM_openInTab, GM_log,
  GM_getResourceText, GM_getResourceURL, GM_download) {
/*%%CODE%%*/
}, /*%%META%%*/null, "/*%%TOKEN%%*/", "/*%%KEY%%*/");
