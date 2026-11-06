/* JSB app: Quick start (the simple, guided way in), Slop check, and the
   phone-friendly menu.  Simple mode hides the advanced pages until asked. */
(function (A) {
  'use strict';
  var h = A.h, J = A.JSB;
  var fText = A.fText, fSelect = A.fSelect, fSwitch = A.fSwitch;
  var grid = A.grid, panel = A.panel;

  /* Plain-words names for each module, for people who just want it to work. */
  var FRIENDLY = {
    time: ['Knows what time it is', 'Morning, night, weekends and seasons change how the character acts.'],
    memory: ['Remembers you', 'Picks up your name, likes, dislikes and fears, and asks for recaps in long chats.'],
    emotions: ['Reads your mood', 'Notices if you sound happy, sad, angry or scared (and gets "not happy" right).'],
    states: ['Reacts to what you say', 'Compliments make them flustered, insults start a fight, apologies make up.'],
    scoring: ['Relationship meters', 'Affection, trust or sanity that rise and fall with your words.'],
    stats: ['Keeps score', 'HP, gold, days... numbers that last between replies.'],
    ensemble: ['More than one character', 'A cast with their own voices, quirks and relationships.'],
    lorebook: ['World facts (lorebook)', 'Places, people and items the bot only hears about when they come up.'],
    pacing: ['Story that moves forward', 'Chapters by chat length, timed events, foreshadowing and payoffs.'],
    random: ['Dice and surprises', 'Real dice rolls and random events, so the bot does not fake them.'],
    ambient: ['Atmosphere', 'Small background details now and then.'],
    style: ['Better writing (anti-slop)', 'Keeps the bot off clichés like "a shiver ran down your spine".'],
    rules: ['If-this-then-that rules', 'Combine anything: "late at night AND sad, THEN be gentle".']
  };
  A.FRIENDLY = FRIENDLY;

  var KINDS = [
    { preset: 'companion', icon: '☕', name: 'Friend or companion', blurb: 'Everyday chat that remembers you.' },
    { preset: 'slowburn', icon: '💕', name: 'Romance', blurb: 'Slow burn with an affection meter.' },
    { preset: 'dungeon', icon: '⚔️', name: 'Adventure / RPG', blurb: 'HP, gold and real dice.' },
    { preset: 'horror', icon: '🕯️', name: 'Horror', blurb: 'Sanity meter and creeping dread.' },
    { preset: 'mystery', icon: '🔍', name: 'Mystery', blurb: 'Clues by stage, no spoilers.' },
    { preset: 'tavern', icon: '🏰', name: 'Fantasy world', blurb: 'A whole world, every feature on.' },
    { preset: 'trio', icon: '👥', name: 'Group of characters', blurb: 'Three people, three voices.' },
    { preset: 'blank', icon: '⬜', name: 'Start empty', blurb: 'Pick every feature yourself.' }
  ];

  var ZONES = [[-10, 'Hawaii (UTC-10)'], [-8, 'US Pacific (UTC-8)'], [-7, 'US Mountain / Pacific summer (UTC-7)'], [-6, 'US Central (UTC-6)'], [-5, 'US Eastern (UTC-5)'], [-4, 'US Eastern summer (UTC-4)'], [-3, 'Brazil, Argentina (UTC-3)'],
    [0, 'UK, Portugal (UTC+0)'], [1, 'Central Europe (UTC+1)'], [2, 'Eastern Europe (UTC+2)'], [3, 'Moscow, Turkey (UTC+3)'], [4, 'Dubai (UTC+4)'], [5.5, 'India (UTC+5:30)'], [7, 'Thailand, Vietnam (UTC+7)'], [8, 'China, Philippines, Perth (UTC+8)'],
    [9, 'Japan, Korea (UTC+9)'], [10, 'Sydney (UTC+10)'], [12, 'New Zealand (UTC+12)']];
  function deviceOffset() { try { return -new Date().getTimezoneOffset() / 60; } catch (e) { return 0; } }

  function step(n, title, kids, sub) {
    return h('section', { class: 'panel step' }, [h('h3', null, [h('span', { class: 'num', text: String(n) }), title]), sub ? h('p', { class: 'sub', text: sub }) : null, kids]);
  }

  /* ================= QUICK START ================= */
  A.views.quick = function () {
    var P = A.P, S = P.settings;
    var view = h('div', { class: 'view quick' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [
      h('span', { class: 'eyebrow', text: 'Quick start · works offline' }),
      h('h1', { text: 'Make a Janitor AI script in four steps' }),
      h('p', { class: 'lede', text: 'Pick a starting point, name your character, switch on what you want, then copy. You can fine-tune everything later.' })
    ])));

    /* 1. kind of bot */
    var kinds = h('div', { class: 'kinds' });
    KINDS.forEach(function (k) {
      var pr = A.PRESETS.filter(function (x) { return x.id === k.preset; })[0];
      if (!pr) return;
      var cur = A.ui.loadedPreset === k.preset;
      var b = h('button', { class: 'kind' + (cur ? ' on' : ''), type: 'button', 'aria-pressed': cur ? 'true' : 'false' }, [h('span', { class: 'ki', 'aria-hidden': 'true', text: k.icon }), h('b', { text: k.name }), h('span', { class: 'kb', text: k.blurb })]);
      var t;
      b.addEventListener('click', function () {
        if (A.ui.dirty && !b.classList.contains('armed')) {
          [].forEach.call(kinds.querySelectorAll('.armed'), function (x) { x.classList.remove('armed'); x.lastChild.textContent = x.getAttribute('data-blurb'); });
          b.setAttribute('data-blurb', k.blurb); b.classList.add('armed'); b.lastChild.textContent = 'Tap again to replace what you have.';
          clearTimeout(t); t = setTimeout(function () { b.classList.remove('armed'); b.lastChild.textContent = k.blurb; }, 4000);
          return;
        }
        var keepName = P.meta.character, keepTz = S.utcOffset;
        var np = pr.make();
        if (keepName && !np.meta.character) np.meta.character = keepName;
        np.settings.utcOffset = keepTz;
        A.ui.loadedPreset = k.preset;
        A.setProject(np);
        A.ui.dirty = false;
        A.toast('Started from ' + k.name);
      });
      kinds.appendChild(b);
    });
    view.appendChild(step(1, 'What kind of bot is it?', kinds, 'Each one is a working example you can change. Your choice fills in step 3 for you.'));

    /* 2. names and time zone */
    var tzOpts = ZONES.map(function (z) { return [String(z[0]), z[1]]; });
    if (!ZONES.some(function (z) { return String(z[0]) === String(S.utcOffset); })) tzOpts.unshift([String(S.utcOffset), 'UTC' + (S.utcOffset >= 0 ? '+' : '') + S.utcOffset]);
    var tzBox = { v: String(S.utcOffset) };
    var tz = fSelect('Your time zone', tzBox, 'v', tzOpts, { onChange: function (v) { S.utcOffset = parseFloat(v) || 0; }, hint: 'Janitor’s clock runs on UTC, so night would be wrong without this.' });
    var dev = deviceOffset();
    view.appendChild(step(2, 'Name it', [grid([
      fText('Character name', P.meta, 'character', { ph: 'e.g. Mara', hint: 'Only for your notes. Inside the script the bot is always {{char}}.', onInput: function () { A.ui.dirty = true; } }),
      fText('Script name', P.meta, 'title', { onInput: function () { A.updateChrome(); } }),
      tz
    ]), h('div', { class: 'row' }, [h('button', { class: 'btn sm', type: 'button', text: 'Use this device’s time zone (UTC' + (dev >= 0 ? '+' : '') + dev + ')', onclick: function () { S.utcOffset = dev; A.changed(true); A.toast('Time zone set'); } })])]));

    /* 3. features */
    var feats = h('div', { class: 'feats' });
    J.MODULES.forEach(function (m) {
      var mod = P.modules[m.id], fr = FRIENDLY[m.id] || [m.name, m.blurb];
      var sw = fSwitch('', mod, 'enabled');
      sw.setAttribute('aria-label', 'Turn ' + fr[0] + ' on or off');
      feats.appendChild(h('div', { class: 'feat' + (mod.enabled ? ' on' : '') }, [
        h('span', { class: 'fi', 'aria-hidden': 'true', text: m.icon }),
        h('div', { class: 'ft' }, [h('b', { text: fr[0] }), h('span', { text: fr[1] })]),
        sw,
        mod.enabled ? h('button', { class: 'btn sm ghost', type: 'button', text: 'Edit', onclick: function () { A.go('mod-' + m.id); } }) : null
      ]));
    });
    view.appendChild(step(3, 'Choose what it can do', feats, 'Switch things on and off. "Edit" opens the details, but the defaults already work.'));

    /* 4. copy and install */
    var errs = A.countFind('error'), warns = A.countFind('warn');
    var status = A.compileError ? h('div', { class: 'banner bad', text: 'The script did not build: ' + A.compileError })
      : errs ? h('div', { class: 'banner bad' }, [errs + ' problem' + (errs === 1 ? '' : 's') + ' to fix first. ', h('a', { href: '#analyze', text: 'Show me', onclick: function (e) { e.preventDefault(); A.go('analyze'); } })])
      : h('div', { class: 'banner ok' }, ['Ready: ' + (A.compiled ? A.compiled.modules.length : 0) + ' features, ' + A.kb(A.compiled ? A.compiled.code.length : 0) + ', checked as safe ES5.' + (warns ? ' ' + warns + ' tip' + (warns === 1 ? '' : 's') + ' in the ' : ''), warns ? h('a', { href: '#analyze', text: 'Analyzer', onclick: function (e) { e.preventDefault(); A.go('analyze'); } }) : null]);
    var big = h('div', { class: 'row bigrow' }, [
      h('button', { class: 'btn primary big', type: 'button', text: 'Copy script', onclick: function () { document.getElementById('copyBtn').click(); } }),
      h('button', { class: 'btn big', type: 'button', text: 'Try it in a test chat', onclick: function () { A.go('chat'); } }),
      h('button', { class: 'btn big', type: 'button', text: 'Save as file', onclick: function () { if (A.compiled) A.download(slugName() + '.js', A.scriptCode(), 'text/javascript'); } }),
      A.bridge && A.bridge() && A.bridge().shareText ? h('button', { class: 'btn big', type: 'button', text: 'Share\u2026', onclick: function () { if (A.compiled) A.bridge().shareText(A.scriptCode()); } }) : null
    ]);
    var how = h('ol', { class: 'install' });
    how.innerHTML = '<li>Open <a href="https://janitorai.com/scripts" target="_blank" rel="noopener">janitorai.com/scripts</a> and tap <b>Create</b>, then <b>Advanced</b>.</li>' +
      '<li>Delete the example code, paste your script, and save.</li>' +
      '<li>Tap <b>Assign to your Characters</b> and pick your bot. <i>It does nothing until it is assigned.</i></li>' +
      '<li>Open a <b>Test Chat</b>, tap <b>Show Debug Panel</b>, send a message and look at the <b>Changes</b> tab to see what the script added.</li>';
    view.appendChild(step(4, 'Copy it into Janitor', [status, big, how]));

    view.appendChild(h('p', { class: 'muted center' }, ['Want every setting? ', h('button', { class: 'linkish', type: 'button', text: A.simple ? 'Switch to Full mode' : 'Open Start & settings', onclick: function () { if (A.simple) A.setSimple(false); A.go('start'); } })]));
    return view;
  };
  function slugName() { return String(A.P.meta.title || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'script'; }

  /* ================= SLOP CHECK ================= */
  A.views.slop = function () {
    var view = h('div', { class: 'view' });
    var st = A.ui.slop || (A.ui.slop = { text: '' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Slop check' }), h('p', { class: 'lede', text: 'Paste a character card, a first message or a few bot replies. This finds worn-out phrases and repeated words that make bots sound generic, so you can rewrite them.' })])));
    var ta = h('textarea', { rows: 10, placeholder: 'Paste text here…', 'aria-label': 'Text to check' });
    ta.value = st.text;
    var out = h('div', { class: 'items' });
    function phrases() {
      var src = A.P.modules.style.phrases || J.defaultProject().modules.style.phrases;
      return String(src).split(',').map(function (x) { return x.replace(/^\s+|\s+$/g, '').toLowerCase(); }).filter(Boolean);
    }
    function flat(t) { return ' ' + String(t).toLowerCase().replace(/['’‘`]/g, '').replace(/[^a-z0-9À-ɏ]+/g, ' ').replace(/^\s+|\s+$/g, '') + ' '; }
    function run() {
      st.text = ta.value; out.innerHTML = '';
      var f = flat(ta.value), found = [];
      if (!ta.value.replace(/\s/g, '')) { out.appendChild(h('p', { class: 'muted', text: 'Nothing to check yet.' })); return; }
      phrases().forEach(function (p) {
        var n = 0, needle = flat(p), at = f.indexOf(needle);
        while (at !== -1 && n < 99) { n++; at = f.indexOf(needle, at + 1); }
        if (n) found.push([p, n]);
      });
      /* Repeated words: a sign of a stuck model or a padded card. */
      var counts = {}, words = f.split(' ').filter(function (w) { return w.length > 4 && !/^(about|their|there|which|would|could|should|after|before|other|these|those|being|where|while|char|user)$/.test(w); });
      words.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
      var reps = Object.keys(counts).filter(function (w) { return counts[w] >= Math.max(4, words.length / 60); }).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8);
      var total = words.length;
      out.appendChild(h('div', { class: 'banner ' + (found.length ? 'warn' : 'ok'), text: found.length ? found.length + ' worn-out phrase' + (found.length === 1 ? '' : 's') + ' found in ' + total + ' words.' : 'No phrases from the list found. Nice.' }));
      found.forEach(function (x) { out.appendChild(h('div', { class: 'find warn' }, [h('span', { class: 'tag warn', text: x[1] + '×' }), h('div', { class: 'fm', text: '"' + x[0] + '"' }), h('span'), h('div', { class: 'fh', text: 'Say what actually happens instead: a specific action, sound or line of dialogue.' })])); });
      if (reps.length) out.appendChild(h('div', { class: 'find info' }, [h('span', { class: 'tag acc', text: 'repeats' }), h('div', { class: 'fm', text: reps.map(function (w) { return w + ' ×' + counts[w]; }).join(', ') }), h('span'), h('div', { class: 'fh', text: 'Words used this often start to stand out. Vary some of them.' })]));
    }
    var addBox = { v: '' };
    view.appendChild(panel('Text', [ta, h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', text: 'Check', onclick: run }), h('button', { class: 'btn ghost', type: 'button', text: 'Clear', onclick: function () { ta.value = ''; run(); } })])]));
    view.appendChild(panel('Results', out));
    view.appendChild(panel('Your avoid list', [
      h('p', { class: 'muted', text: 'The check uses the phrase list from the Writing Style feature (' + phrases().length + ' phrases). Add the ones your bot overuses:' }),
      h('div', { class: 'row' }, [h('div', { style: { flex: '1 1 220px' } }, fText('', addBox, 'v', { ph: 'e.g. eyes glinting' })), h('button', { class: 'btn', type: 'button', text: 'Add to list', onclick: function () {
        var v = String(addBox.v || '').replace(/^\s+|\s+$/g, '').replace(/,/g, ' ');
        if (!v) return;
        var m = A.P.modules.style; m.phrases = (m.phrases ? m.phrases + ', ' : '') + v; addBox.v = ''; A.changed(true); A.toast('Added. Turn on Writing Style to use it in the script.');
      } }), h('button', { class: 'btn ghost', type: 'button', text: 'Edit the full list', onclick: function () { A.go('mod-style'); } })])
    ]));
    setTimeout(run, 0);
    return view;
  };

  /* ================= SIMPLE / FULL MODE + PHONE MENU ================= */
  A.setSimple = function (on) {
    A.simple = !!on;
    try { window.localStorage.setItem('jsb.simple', on ? '1' : '0'); } catch (e) {}
    var b = document.getElementById('modeBtn');
    if (b) { b.textContent = on ? 'Simple' : 'Full'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = on ? 'Simple mode: only the pages you need. Tap for every tool.' : 'Full mode: every tool. Tap for the simple view.'; }
    A.renderShell();
    A.rerender();
    A.markNav();
  };
  A.initEasy = function () {
    var v = null;
    try { v = window.localStorage.getItem('jsb.simple'); } catch (e) {}
    A.simple = v === null ? true : v === '1';
    var mb = document.getElementById('modeBtn');
    if (mb) mb.addEventListener('click', function () { A.setSimple(!A.simple); A.toast(A.simple ? 'Simple mode: just the essentials' : 'Full mode: every tool is in the menu'); });
    var nb = document.getElementById('navBtn');
    if (nb) nb.addEventListener('click', function () { document.body.classList.toggle('nav-open'); nb.setAttribute('aria-expanded', document.body.classList.contains('nav-open') ? 'true' : 'false'); });
    document.getElementById('side').addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.nav')) closeNav(); });
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', closeNav);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    var b = document.getElementById('modeBtn');
    if (b) { b.textContent = A.simple ? 'Simple' : 'Full'; b.setAttribute('aria-pressed', A.simple ? 'true' : 'false'); }
  };
  function closeNav() { document.body.classList.remove('nav-open'); var nb = document.getElementById('navBtn'); if (nb) nb.setAttribute('aria-expanded', 'false'); }
})(App);
