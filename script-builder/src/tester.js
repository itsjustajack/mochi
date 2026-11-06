/* JSB tester: runs a Janitor script the way Janitor does, offline.
   In a browser each batch runs inside a throwaway Web Worker so an endless
   loop can be killed; if Workers are blocked it falls back to running in the
   page (no timeout).  The clock and Math.random can be pinned. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JSBTest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Runs one script against one input.  Kept self-contained: it is also
     shipped into the Worker as source text. */
  function execOne(code, input) {
    var logs = [];
    function fmt(a) {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    var fakeConsole = {
      log: function () { logs.push([].slice.call(arguments).map(fmt).join(' ')); },
      warn: function () { logs.push('[warn] ' + [].slice.call(arguments).map(fmt).join(' ')); },
      error: function () { logs.push('[error] ' + [].slice.call(arguments).map(fmt).join(' ')); },
      info: function () { logs.push([].slice.call(arguments).map(fmt).join(' ')); }
    };
    var RealDate = Date, D = RealDate;
    if (input.date) {
      var fixed = new RealDate(input.date).getTime();
      D = function (a, b, c, d, e, f, g) {
        if (!(this instanceof D)) return new RealDate(fixed).toString();
        if (arguments.length === 0) return new RealDate(fixed);
        return new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))();
      };
      D.now = function () { return fixed; };
      D.UTC = RealDate.UTC; D.parse = RealDate.parse; D.prototype = RealDate.prototype;
    }
    var M = Math;
    if (input.seed !== undefined && input.seed !== null && input.seed !== '') {
      var seed = (parseInt(input.seed, 10) || 1) % 233280;
      M = Object.create(Math);
      M.random = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    }
    var ch = input.character || {};
    var context = {
      chat: JSON.parse(JSON.stringify(input.chat || {})),
      character: {
        name: ch.name === undefined ? 'Bot' : ch.name,
        personality: ch.personality === undefined ? '' : ch.personality,
        scenario: ch.scenario === undefined ? '' : ch.scenario,
        example_dialogs: ch.example_dialogs === undefined ? '' : ch.example_dialogs
      }
    };
    var before = { personality: context.character.personality, scenario: context.character.scenario };
    var t0 = RealDate.now(), error = null;
    try {
      var fn = new Function('context', 'console', 'Date', 'Math', code);
      fn(context, fakeConsole, D, M);
    } catch (e) {
      error = (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
    }
    var after = context.character;
    function added(field) {
      var b = before[field], a = after[field];
      if (typeof a !== 'string') return { text: '', kept: false, type: typeof a };
      if (a.indexOf(b) === 0) return { text: a.slice(b.length), kept: true, type: 'string' };
      return { text: a, kept: b === '', type: 'string' };
    }
    var p = added('personality'), s = added('scenario');
    return {
      error: error,
      ms: RealDate.now() - t0,
      logs: logs,
      personality: typeof after.personality === 'string' ? after.personality : String(after.personality),
      scenario: typeof after.scenario === 'string' ? after.scenario : String(after.scenario),
      addedP: p.text, addedS: s.text,
      keptP: p.kept, keptS: s.kept,
      typeP: p.type, typeS: s.type
    };
  }

  function execMany(code, inputs) {
    var out = [];
    for (var i = 0; i < inputs.length; i++) out.push(execOne(code, inputs[i]));
    return out;
  }

  var WORKER_SRC = execOne.toString() + '\n' + execMany.toString() +
    '\nself.onmessage = function (e) { var r; try { r = execMany(e.data.code, e.data.inputs); } catch (x) { r = { fatal: String(x) }; } self.postMessage(r); };';

  var workerOk = null; /* unknown until first try */
  function canWorker() {
    return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && workerOk !== false;
  }

  /* runBatch(code, inputs, {timeout}) -> Promise<{results, mode, timedOut}> */
  function runBatch(code, inputs, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 4000;
    return new Promise(function (resolve) {
      if (!canWorker()) {
        resolve({ results: execMany(code, inputs), mode: 'page', timedOut: false });
        return;
      }
      var w, url, done = false, timer;
      try {
        url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        w = new Worker(url);
      } catch (e) {
        workerOk = false;
        if (url) URL.revokeObjectURL(url);
        resolve({ results: execMany(code, inputs), mode: 'page', timedOut: false });
        return;
      }
      function finish(r) {
        if (done) return;
        done = true; clearTimeout(timer);
        try { w.terminate(); } catch (e) {}
        URL.revokeObjectURL(url);
        resolve(r);
      }
      w.onmessage = function (e) {
        workerOk = true;
        if (e.data && e.data.fatal) finish({ results: [], mode: 'worker', timedOut: false, fatal: e.data.fatal });
        else finish({ results: e.data, mode: 'worker', timedOut: false });
      };
      w.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (workerOk === null) { /* worker could not start (CSP etc): fall back */
          workerOk = false;
          done = true; clearTimeout(timer);
          try { w.terminate(); } catch (x) {}
          URL.revokeObjectURL(url);
          resolve({ results: execMany(code, inputs), mode: 'page', timedOut: false });
          return;
        }
        finish({ results: [], mode: 'worker', timedOut: false, fatal: (e && e.message) || 'worker error' });
      };
      timer = setTimeout(function () {
        if (workerOk === null) workerOk = true; /* it started, the script hung */
        finish({ results: [], mode: 'worker', timedOut: true });
      }, timeout);
      w.postMessage({ code: code, inputs: inputs });
    });
  }

  /* ---------- fuzz suite ---------- */
  var LONG = (function () { var a = [], i; for (i = 0; i < 400; i++) a.push('word' + (i % 37)); return a.join(' '); })();
  var FUZZ_CHATS = [
    { label: 'Normal message', chat: { last_message: 'Hello! How are you today?', message_count: 5 } },
    { label: 'Empty message', chat: { last_message: '', message_count: 1 } },
    { label: 'No last_message field', chat: { message_count: 3 } },
    { label: 'last_message is null', chat: { last_message: null, message_count: 2 } },
    { label: 'First message (count 0)', chat: { last_message: 'hi', message_count: 0 } },
    { label: 'Very long chat (count 5000)', chat: { last_message: 'still here', message_count: 5000 } },
    { label: 'Huge message (2,800 chars)', chat: { last_message: LONG, message_count: 12 } },
    { label: 'Unicode, emoji and smart quotes', chat: { last_message: '\u00e9migr\u00e9 caf\u00e9 \u6771\u4eac \ud83d\ude00 \u2014 \u201cquotes\u201d \u2018it\u2019s\u2019', message_count: 7 } },
    { label: 'Only punctuation', chat: { last_message: '?!... ,,, ---', message_count: 4 } },
    { label: 'SHOUTING', chat: { last_message: 'WHY WOULD YOU DO THAT I AM SO ANGRY', message_count: 9 } },
    { label: 'last_messages as strings', chat: { last_message: 'and then?', message_count: 20, last_messages: ['tell me a secret', 'the dragon is coming', 'and then?'] } },
    { label: 'last_messages as objects', chat: { last_message: 'ok', message_count: 21, last_messages: [{ message: 'i love apples' }, { is_bot: true, message: 'Mara nods.' }, { message: 'ok' }] } },
    { label: 'last_messages with junk items', chat: { last_message: 'x', message_count: 22, last_messages: [null, 5, {}, 'x'] } },
    { label: 'message_count is a string', chat: { last_message: 'hey', message_count: '15' } },
    { label: 'Negation ("not happy")', chat: { last_message: "I'm not happy and I don't love this", message_count: 11 } }
  ];
  var FUZZ_DATES = [
    { label: 'Mon 03:00 UTC (night)', date: '2026-01-05T03:00:00Z' },
    { label: 'Wed 09:30 UTC (morning)', date: '2026-04-15T09:30:00Z' },
    { label: 'Fri 14:00 UTC (afternoon)', date: '2026-07-17T14:00:00Z' },
    { label: 'Sat 19:45 UTC (evening)', date: '2026-10-24T19:45:00Z' },
    { label: 'Sun 23:59 UTC (late night)', date: '2026-12-27T23:59:00Z' }
  ];
  var JUNK = /undefined|\bNaN\b|\[object Object\]|\bnull\b|function\s*\(/;

  function fuzzInputs(character, opts) {
    opts = opts || {};
    var list = [], i, j;
    for (i = 0; i < FUZZ_CHATS.length; i++) {
      for (j = 0; j < FUZZ_DATES.length; j++) {
        list.push({ label: FUZZ_CHATS[i].label + ' / ' + FUZZ_DATES[j].label, chat: FUZZ_CHATS[i].chat, date: FUZZ_DATES[j].date, seed: opts.seed === undefined ? (i * 7 + j + 1) : opts.seed, character: character });
      }
    }
    return list;
  }

  /* Grade one result: list of {level, text}. */
  function grade(r, opts) {
    opts = opts || {};
    var f = [];
    if (r.error) f.push({ level: 'error', text: 'Threw ' + r.error + '. On Janitor this usually means nothing is added at all.' });
    if (r.typeP !== 'string' || r.typeS !== 'string') f.push({ level: 'error', text: 'personality or scenario stopped being a string.' });
    if (!r.keptP) f.push({ level: 'error', text: 'Personality was overwritten: the character card text is gone. Use += instead of =.' });
    if (!r.keptS) f.push({ level: 'error', text: 'Scenario was overwritten: the original text is gone. Use += instead of =.' });
    var add = (r.addedP || '') + '\n' + (r.addedS || '');
    var m = add.match(JUNK);
    if (m) f.push({ level: 'warn', text: 'Injected text contains "' + m[0] + '", which is usually a bug that leaks into the prompt.' });
    if (r.ms > (opts.slowMs || 250)) f.push({ level: 'warn', text: 'Slow: took ' + r.ms + ' ms.' });
    if (opts.budget && add.length > opts.budget + 200) f.push({ level: 'warn', text: 'Added ' + add.length + ' characters (budget ' + opts.budget + ').' });
    (r.logs || []).forEach(function (l) { if (/ERROR|\[error\]/.test(l)) f.push({ level: 'warn', text: 'Logged: ' + l.slice(0, 200) }); });
    return f;
  }

  return {
    execOne: execOne,
    execMany: execMany,
    runBatch: runBatch,
    fuzzInputs: fuzzInputs,
    grade: grade,
    FUZZ_CHATS: FUZZ_CHATS,
    FUZZ_DATES: FUZZ_DATES,
    WORKER_SRC: WORKER_SRC
  };
});
