/* JSB app: start page and the eleven module forms. */
(function (A) {
  'use strict';
  var h = A.h, J = A.JSB;
  var fText = A.fText, fNum = A.fNum, fCheck = A.fCheck, fSelect = A.fSelect, fRange = A.fRange, fSwitch = A.fSwitch, fTarget = A.fTarget;
  var grid = A.grid, panel = A.panel, repeater = A.repeater;
  function M(id) { return A.P.modules[id]; }
  function modInfo(id) { return J.MODULES.filter(function (m) { return m.id === id; })[0]; }
  function prio(obj, hint) { if (A.simple) return null; return fNum('Priority', obj, 'prio', { hint: hint || 'Higher goes first when the size budget runs out.' }); }
  function depth(obj, hint) { return fNum('Messages scanned', obj, 'depth', { min: 1, max: 30, step: 1, hint: hint || 'How many recent messages to read. 1 = only the latest.' }); }
  var KEYHINT = 'Comma-separated. Whole words by default. Use /regex/i for patterns.';

  /* ================= START ================= */
  A.views.start = function () {
    var P = A.P, S = P.settings;
    var view = h('div', { class: 'view' });

    var sample = '/* JanitorAI Script Builder 1.0.0 */\n(function () {\n  var DEBUG = false;\n  var MAX_CHARS = 2500;\n  ...\n  safe("lorebook", runLorebook);\n  safe("rules", runRules);\n  flush();\n})();';
    view.appendChild(h('div', { class: 'hero' }, [
      h('div', { class: 'pitch' }, [
        h('span', { class: 'eyebrow', text: 'Offline \u00b7 no API \u00b7 no account' }),
        h('h1', { text: 'Build Janitor AI scripts that actually run.' }),
        h('p', { class: 'lede', text: 'Turn on the modules you want, fill in plain text, and copy one ready-to-paste ES5 Advanced script. Every script is checked against strict ES5 and stress-tested before you paste it into Janitor.' }),
        h('div', { class: 'facts' }, [h('span', { class: 'tag ok', text: 'Strict ES5' }), h('span', { class: 'tag', text: '11 modules' }), h('span', { class: 'tag', text: 'Append-only (+=)' }), h('span', { class: 'tag', text: 'Error-isolated' }), h('span', { class: 'tag', text: 'Runs in your browser' })]),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn primary', type: 'button', text: 'See the script', onclick: function () { A.go('output'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Try it in the chat simulator', onclick: function () { A.go('chat'); } })
        ])
      ]),
      h('pre', { class: 'snippet', 'aria-label': 'Shape of a generated script', text: sample })
    ]));

    /* presets */
    var pres = h('div', { class: 'presets' });
    A.PRESETS.forEach(function (pr) {
      var b = h('button', { class: 'preset', type: 'button' }, [h('b', { text: pr.title }), h('span', { text: pr.blurb })]);
      b.addEventListener('click', function () {
        A.newProject(pr.make(), { preset: pr.id, source: 'preset' }); A.toast('Opened ' + pr.title + ' as a new project. Your old one is in My projects.');
      });
      pres.appendChild(b);
    });
    view.appendChild(panel('Presets', pres, 'Each one is a complete, working project. It opens as a new project; the one you have now stays in My projects.'));

    /* modules */
    var mods = h('div', { class: 'mods' });
    J.MODULES.forEach(function (m) {
      var on = P.modules[m.id].enabled;
      var sw = fSwitch('', P.modules[m.id], 'enabled');
      sw.setAttribute('aria-label', 'Turn ' + m.name + ' on or off');
      mods.appendChild(h('div', { class: 'mod' + (on ? ' on' : '') }, [
        h('span', { class: 'mi', 'aria-hidden': 'true', text: m.icon }),
        h('a', { href: '#mod-' + m.id, onclick: function (e) { e.preventDefault(); A.go('mod-' + m.id); } }, h('b', { text: m.name })),
        sw,
        h('p', { text: m.blurb })
      ]));
    });
    view.appendChild(panel('Modules', mods, 'Click a name to edit it. Modules run in this order, so later ones (like Combined Rules) can react to earlier ones.'));

    /* project + settings */
    view.appendChild(panel('Project', grid([
      fText('Title', P.meta, 'title', { onInput: function () { A.updateChrome(); } }),
      fText('Character', P.meta, 'character', { ph: 'Who this script is for' }),
      fText('Notes', P.meta, 'notes', { area: true, rows: 2, span: true, ph: 'Only for you. Not included in the script.' })
    ], 'two')));

    view.appendChild(panel('Script settings', [
      grid([
        fNum('Size budget (characters)', S, 'maxChars', { min: 200, step: 100, hint: 'Most text added per reply. Lower-priority text is dropped first.' }),
        fNum('Time zone (UTC offset)', S, 'utcOffset', { step: 0.5, hint: 'Janitor\u2019s clock is UTC. New York is -5 (or -4 in summer), London 0, Tokyo 9.' }),
        fSelect('Randomness', S, 'randomMode', [['random', 'Random every reply'], ['stable', 'Stable (same message, same roll)']], { hint: 'Stable stops rerolls from changing events.' }),
        fSelect('Engine style', S, 'engine', [['compact', 'Compact (smaller)'], ['readable', 'Readable (with comments)']]),
        fText('Log tag', S, 'tag', { hint: 'Prefix for debug logs.' }),
        fSelect('Before personality text', S, 'leadPersonality', [['\n\n', 'Blank line'], ['\n', 'New line'], [' ', 'Space']]),
        fSelect('Before scenario text', S, 'leadScenario', [['\n\n', 'Blank line'], ['\n', 'New line'], [' ', 'Space']]),
        fSelect('Between items', S, 'join', [['\n', 'New line'], [' ', 'Space'], ['\n\n', 'Blank line']])
      ]),
      h('div', { class: 'grid two' }, [
        fCheck('Debug logging', S, 'debug', { hint: 'Writes what fired to the debug panel console. Turn it off before publishing.' }),
        fCheck('Split into separate scripts', S, 'split', { structural: true, hint: 'One script per module (linked modules stay together). Easier to share, but each runs separately.' })
      ])
    ]));
    return view;
  };

  /* ================= MODULE PAGE ================= */
  A.renderModule = function (id) {
    var m = M(id), info = modInfo(id);
    if (!m || !info) return h('div', { class: 'banner bad', text: 'Unknown module.' });
    var view = h('div', { class: 'view' });
    var errs = A.findings.filter(function (f) { return f.module === id; });
    view.appendChild(h('div', { class: 'modhead' }, [
      h('span', { class: 'big', 'aria-hidden': 'true', text: info.icon }),
      h('div', { class: 't' }, [h('h1', { text: info.name }), h('p', { class: 'lede', text: info.blurb })]),
      fSwitch(m.enabled ? 'On' : 'Off', m, 'enabled')
    ]));
    if (!m.enabled) view.appendChild(h('div', { class: 'off-note' }, ['This module is off, so none of this goes into the script.', h('button', { class: 'btn sm', type: 'button', text: 'Turn it on', onclick: function () { m.enabled = true; A.changed(true); } })]));
    if (errs.length) {
      var box = h('div', { class: 'items' });
      errs.slice(0, 6).forEach(function (f) { box.appendChild(h('div', { class: 'find ' + f.level }, [h('span', { class: 'tag ' + (f.level === 'error' ? 'bad' : f.level === 'warn' ? 'warn' : 'acc'), text: f.level }), h('div', { class: 'fm', text: f.message }), h('span'), f.hint ? h('div', { class: 'fh', text: f.hint }) : null])); });
      if (errs.length > 6) box.appendChild(h('a', { href: '#analyze', text: 'See all ' + errs.length + ' findings', onclick: function (e) { e.preventDefault(); A.go('analyze'); } }));
      view.appendChild(box);
    }
    add(view, FORMS[id](m));
    return view;
  };
  function add(el, k) { return A.add(el, k); }

  var FORMS = {};

  /* ---------- time ---------- */
  FORMS.time = function (m) {
    var out = [];
    out.push(panel('Basics', grid([
      fTarget(m), prio(m),
      fNum('Time zone (UTC offset)', A.P.settings, 'utcOffset', { step: 0.5, hint: 'Shared with every module. Janitor runs on UTC.' }),
      fCheck('Add a clock line', m, 'clock', { hint: 'e.g. "Current time: Friday, 21:40 (evening)."' }),
      fCheck('Southern hemisphere', m, 'southern', { hint: 'Flips the seasons.' })
    ])));
    out.push(panel('Periods of the day', repeater({
      items: m.periods, addLabel: 'Add period',
      title: function (p) { return p.name || 'period'; },
      sub: function (p) { return pad(p.from) + ':00 \u2013 ' + pad(p.to) + ':00'; },
      make: function () { return { name: 'new', from: 0, to: 6, text: '' }; },
      body: function (p) {
        return [grid([fText('Name', p, 'name', { hint: 'Used by rules and ambient filters.' }), fNum('From hour', p, 'from', { min: 0, max: 23, step: 1 }), fNum('To hour', p, 'to', { min: 0, max: 24, step: 1, hint: 'Can wrap past midnight (21 to 5).' })]),
          fText('Text', p, 'text', { area: true, rows: 2 })];
      }
    }), 'Hours in your time zone. The first period that contains the hour wins.'));
    var days = grid(J.WEEKDAYS.map(function (d) { return fText(cap(d), m.days, d, { area: true, rows: 2, ph: 'Optional' }); }), 'three');
    out.push(panel('Weekdays', days, 'Optional extra line on a given day.'));
    out.push(panel('Seasons', grid(J.SEASONS.map(function (s) { return fText(cap(s), m.seasons, s, { area: true, rows: 2, ph: 'Optional' }); }), 'two'), 'Spring is March to May in the north.'));
    return out;
  };

  /* ---------- memory ---------- */
  FORMS.memory = function (m) {
    return [
      panel('Basics', grid([fTarget(m), prio(m), depth(m), fNum('Most facts per reply', m, 'maxItems', { min: 1, step: 1 })]),
        'Scripts are stateless, so memory only sees the messages Janitor passes in. A name said 40 messages ago is gone.'),
      panel('Name', [fCheck('Remember the user\u2019s name', m, 'captureName'),
        grid([fText('Phrases', m, 'namePhrases', { area: true, rows: 2, hint: 'The next word after one of these, if capitalised, is taken as the name.' }),
          fText('Template', m, 'nameTemplate', { area: true, rows: 2, hint: '$1 is the captured name.' })], 'two')]),
      panel('Likes, dislikes and fears', [fCheck('Remember preferences', m, 'capturePrefs'),
        grid([fText('Like phrases', m, 'likePhrases', { area: true, rows: 2 }), fText('Dislike phrases', m, 'dislikePhrases', { area: true, rows: 2 }), fText('Fear phrases', m, 'fearPhrases', { area: true, rows: 2 })], 'three')],
        'Write phrases without apostrophes ("im", "dont"): messages are matched with apostrophes removed.'),
      panel('Custom facts', repeater({
        items: m.facts, addLabel: 'Add fact',
        title: function (f) { return f.label || 'fact'; },
        make: function () { return { label: 'job', phrases: 'i work as, my job is', words: 2, template: '{{user}} works as $1.' }; },
        body: function (f) { return [grid([fText('Label', f, 'label', { hint: 'Rules can check "remembered: label".' }), fNum('Words to capture', f, 'words', { min: 1, max: 6, step: 1 })]), fText('Phrases', f, 'phrases', { hint: 'Comma-separated.' }), fText('Template', f, 'template', { hint: '$1 is what was captured.' })]; }
      })),
      panel('Recap nudges', [grid([fNum('Ask for a recap every', m, 'recapEvery', { min: 0, step: 2, hint: 'Messages. 0 = off. 20 to 30 works well for long chats.' })]),
        fText('Recap request', m, 'recapText', { area: true, rows: 2 })],
        'Long chats push early events out of the bot\u2019s view. Every so often this asks the bot to write a short recap into the chat, which keeps the important parts visible.')
    ];
  };

  /* ---------- emotions ---------- */
  FORMS.emotions = function (m) {
    var rows = J.EMOTIONS.map(function (e) {
      var words = (J.LEXICON[e] || []).slice(0, 10).map(function (w) { return Array.isArray(w) ? w[0] : (w.w || w); }).join(', ');
      return h('div', { class: 'item' }, [h('div', { class: 'ih' }, h('div', { class: 'it' }, [cap(e), h('small', { text: J.EMOTION_LABELS[e] })])),
        h('div', { class: 'ib' }, grid([fText('Reaction when detected', m.reactions, e, { area: true, rows: 2 }), fText('Extra words', m.extra, e, { area: true, rows: 2, hint: 'Built in: ' + words + '\u2026' })], 'two'))]);
    });
    return [
      panel('Basics', grid([fTarget(m), prio(m), depth(m),
        fNum('Detect at score', m, 'threshold', { step: 0.5, hint: 'Lower = more sensitive.' }),
        fNum('"Strong" at score', m, 'strongAt', { step: 0.5 }),
        fCheck('Announce the emotion', m, 'announce', { hint: 'Adds "{{user}} seems sad." before the reaction.' })]),
        'Eight basic emotions. "Not happy" counts against joy, and older messages count less.'),
      panel('Reactions', h('div', { class: 'items' }, rows))
    ];
  };

  /* ---------- states ---------- */
  FORMS.states = function (m) {
    return [
      panel('Basics', grid([fTarget(m), prio(m), depth(m), fText('Fallback name', m, 'fallbackName'), fText('Fallback text', m, 'fallback', { area: true, rows: 2, span: true, hint: 'Used when no state matches. Leave empty to add nothing.' })]),
        'The state with the most trigger hits wins. Rules can check the current state.'),
      panel('States', repeater({
        items: m.list, addLabel: 'Add state', collapsible: true,
        title: function (s) { return s.name || 'state'; }, sub: function (s) { return s.keys; },
        make: function () { return { name: 'New state', keys: '', text: '', escalated: '', escalateAt: 3, prio: 1 }; },
        body: function (s) { return [grid([fText('Name', s, 'name'), fNum('Tie-break priority', s, 'prio', { step: 1 }), fNum('Escalate at hits', s, 'escalateAt', { min: 0, step: 1 })]), fText('Trigger words', s, 'keys', { hint: KEYHINT }), fText('Text', s, 'text', { area: true, rows: 2 }), fText('Escalated text', s, 'escalated', { area: true, rows: 2, hint: 'Replaces the text once the hits reach the escalation count.' })]; }
      }))
    ];
  };

  /* ---------- scoring ---------- */
  FORMS.scoring = function (m) {
    return [panel('Meters', repeater({
      items: m.meters, addLabel: 'Add meter', collapsible: true,
      title: function (x) { return x.name || 'meter'; }, sub: function (x) { return x.min + ' to ' + x.max + ', ' + (x.tiers || []).length + ' tiers'; },
      make: function () { return { name: 'Affection', start: 0, min: 0, max: 100, growth: 1, depth: 5, up: 'thank you, kind, sweet', down: 'rude, hate:2', target: 'personality', prio: 58, carry: false, show: false, tiers: [{ name: 'low', from: 0, to: 30, text: '' }, { name: 'high', from: 31, to: 100, text: '' }] }; },
      body: function (x) {
        return [
          grid([fText('Name', x, 'name'), fNum('Start', x, 'start'), fNum('Min', x, 'min'), fNum('Max', x, 'max'), fNum('Growth per 10 messages', x, 'growth', { step: 0.5, hint: 'Slow drift as the chat goes on.' }), fNum('Messages scanned', x, 'depth', { min: 1, step: 1 }), fTarget(x), prio(x)]),
          grid([fText('Raises it', x, 'up', { area: true, rows: 2, hint: 'word or word:weight. "Not kind" counts as negative.' }), fText('Lowers it', x, 'down', { area: true, rows: 2 })], 'two'),
          grid([fCheck('Carry between replies (experimental)', x, 'carry', { hint: 'Asks the bot to write [' + (x.name || 'Name') + ': N] at the end of replies and reads it back. Only as reliable as the bot.' }),
            fCheck('Show the value', x, 'show', { hint: 'Adds "Trust: 12 (friendly)".' })], 'two'),
          h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Tiers' }), repeater({
            items: x.tiers, addLabel: 'Add tier', noDup: true,
            title: function (t) { return t.name || 'tier'; }, sub: function (t) { return t.from + ' to ' + t.to; },
            make: function () { return { name: 'tier', from: 0, to: 10, text: '' }; },
            body: function (t) { return [grid([fText('Name', t, 'name'), fNum('From', t, 'from'), fNum('To', t, 'to')]), fText('Text', t, 'text', { area: true, rows: 2 })]; }
          })])
        ];
      }
    }), 'A meter is worked out fresh each reply from words in recent messages and the message count. Janitor has no saved state.')];
  };

  /* ---------- ensemble ---------- */
  var OCEAN = [['O', 'Openness', 'Curious, imaginative'], ['C', 'Conscientiousness', 'Organised, careful'], ['E', 'Extraversion', 'Outgoing, energetic'], ['A', 'Agreeableness', 'Kind, cooperative'], ['N', 'Neuroticism', 'Anxious, moody']];
  FORMS.ensemble = function (m) {
    var cast = m.cast;
    function equalise() { var n = cast.length; if (!n) return; cast.forEach(function (a) { a.focus = Math.round(100 / n); }); A.changed(true); A.toast('Focus split evenly'); }
    return [
      panel('Scene', grid([prio(m), depth(m, 'Where names and aliases are looked for.'), fNum('Most on stage', m, 'maxActive', { min: 1, step: 1 }), fNum('Characters budget', m, 'budget', { min: 100, step: 100, hint: 'Shared by the cast, split by focus.' }),
        fText('Direction', m, 'direction', { area: true, rows: 2, span: true })])),
      panel(h('span', { class: 'sec-title', style: { flex: '1' } }, ['Cast', h('button', { class: 'btn sm', type: 'button', text: 'Split focus evenly', onclick: equalise })]), repeater({
        items: cast, addLabel: 'Add character', collapsible: true, startClosed: cast.length > 2,
        title: function (a) { return a.name || 'character'; }, sub: function (a) { return (a.presence === 'always' ? 'always present' : 'when mentioned') + ' \u00b7 focus ' + a.focus; },
        make: function () { return J.newActor({ name: 'New character' }); },
        onDup: function (c) { c.id = J.uid('actor'); c.name += ' copy'; },
        body: function (a) { return actorBody(a, cast); }
      }), 'Characters join the scene when their name or alias comes up (or are always there). Each one gets its own personality, voice and relationships.')
    ];
  };
  function actorBody(a, cast) {
    var out = [];
    out.push(grid([fText('Name', a, 'name'), fText('Aliases', a, 'aliases', { hint: 'Comma-separated nicknames.' }),
      fSelect('On stage', a, 'presence', [['mentioned', 'When mentioned'], ['always', 'Always']]),
      fRange('Focus', a, 'focus', 0, 100, 5, { hint: 'Share of the budget.' }),
      fSelect('Temperament', a, 'temperament', Object.keys(J.TEMPERAMENTS).map(function (k) { return [k, k ? k + ' (' + J.TEMPERAMENTS[k] + ')' : 'None']; })),
      fCheck('Case-sensitive name', a, 'cs'),
      fCheck('Enabled', a, 'enabled', { structural: true })]));
    out.push(fText('Snapshot', a, 'snapshot', { area: true, rows: 2, ph: 'Role, age, look, the one-line pitch.' }));
    var oc = h('div', { class: 'ocean' });
    var oText = h('p', { class: 'muted small', text: J.oceanText(a) });
    OCEAN.forEach(function (o) { oc.appendChild(fRange(o[1], a.ocean, o[0], 0, 1, 0.05, { hint: o[2], onInput: function () { oText.textContent = J.oceanText(a); } })); });
    out.push(h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Personality (OCEAN)' }), oc, oText]));
    out.push(fText('More traits', a, 'traitsExtra', { ph: 'Anything the sliders miss.' }));
    out.push(h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Voice' }), grid([
      fSelect('Tone', a.speech, 'tone', J.SPEECH.tone), fSelect('Pacing', a.speech, 'pacing', J.SPEECH.pacing),
      fSelect('Length', a.speech, 'verbosity', J.SPEECH.verbosity), fSelect('Diction', a.speech, 'diction', J.SPEECH.diction),
      fText('Speech notes', a.speech, 'notes', { span: true, ph: 'Catchphrases, accent, verbal tics.' })])]));
    out.push(quirkPicker(a));
    var cues = grid(J.EMOTIONS.map(function (e) { return fText(cap(e), a.cues, e); }), 'two');
    out.push(h('details', { class: 'fold' }, [h('summary', { text: 'Emotion cues (used when the Emotion Engine detects a mood)' }), cues]));
    var targets = [['user', '{{user}}']].concat(cast.filter(function (x) { return x !== a; }).map(function (x) { return [x.id, x.name]; }));
    out.push(h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Relationships' }), repeater({
      items: a.relations, addLabel: 'Add relationship', noDup: true,
      title: function (r) { var t = targets.filter(function (x) { return x[0] === r.to; })[0]; return (t ? t[1] : r.to) + ': ' + r.type; },
      make: function () { return J.newRelation('user', 'ally'); },
      body: function (r) {
        var sliders = h('div', { class: 'ocean' });
        function fill() { sliders.innerHTML = ''; ['trust', 'affinity', 'respect', 'rivalry', 'influence'].forEach(function (k) { sliders.appendChild(fRange(cap(k), r, k, 0, 1, 0.05)); }); }
        fill();
        return [grid([fSelect('Toward', r, 'to', targets, { structural: true }),
          fSelect('Type', r, 'type', Object.keys(J.REL_PRESETS).map(function (k) { return [k, cap(k)]; }), { hint: (J.REL_PRESETS[r.type] || {}).tip, onChange: function (v) { var p = J.REL_PRESETS[v]; if (p && v !== 'custom') { ['trust', 'affinity', 'respect', 'rivalry', 'influence'].forEach(function (k) { r[k] = p[k]; }); } }, structural: true })]),
          r.raw ? fText('Imported wording (used instead of the sliders; clear it to use them)', r, 'raw', { structural: false }) : null,
          sliders, fText('Note', r, 'note', { ph: 'e.g. Owes her money.' })];
      }
    })]));
    return out;
  }
  function quirkPicker(a) {
    var box = h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Quirks (one is shown per reply, rotating)' })]);
    var sel = h('div', { class: 'chips' });
    function drawSel() {
      sel.innerHTML = '';
      if (!a.quirks.length) sel.appendChild(h('span', { class: 'muted small', text: 'None picked yet.' }));
      a.quirks.forEach(function (q, i) { sel.appendChild(h('button', { class: 'chip sel', type: 'button', title: 'Remove', text: q + ' \u2715', onclick: function () { a.quirks.splice(i, 1); drawSel(); drawLib(); A.changed(false); } })); });
    }
    var lib = h('div', { class: 'chips' });
    var cat = 'physical';
    var tabs = h('div', { class: 'row' });
    function drawLib() {
      lib.innerHTML = ''; tabs.innerHTML = '';
      Object.keys(J.QUIRKS).forEach(function (c) { tabs.appendChild(h('button', { class: 'btn sm' + (c === cat ? ' primary' : ''), type: 'button', text: cap(c), onclick: function () { cat = c; drawLib(); } })); });
      J.QUIRKS[cat].forEach(function (q) {
        var on = a.quirks.indexOf(q) !== -1;
        lib.appendChild(h('button', { class: 'chip' + (on ? ' sel' : ''), type: 'button', text: q, 'aria-pressed': on ? 'true' : 'false', onclick: function () {
          var i = a.quirks.indexOf(q); if (i === -1) a.quirks.push(q); else a.quirks.splice(i, 1); drawSel(); drawLib(); A.changed(false);
        } }));
      });
    }
    var custom = h('input', { type: 'text', placeholder: 'Write your own and press Enter', id: 'q' + a.id });
    custom.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = custom.value.trim(); if (v) { a.quirks.push(v); custom.value = ''; drawSel(); drawLib(); A.changed(false); } } });
    drawSel(); drawLib();
    A.add(box, [sel, h('details', { class: 'fold' }, [h('summary', { text: 'Quirk library' }), tabs, lib]), custom]);
    return box;
  }

  /* ---------- lorebook ---------- */
  var CATS = ['place', 'character', 'item', 'creature', 'theme', 'event', 'faction', 'rule', 'other'];
  FORMS.lorebook = function (m) {
    var q = A.ui.lbSearch || '';
    var search = h('input', { type: 'search', id: 'lbSearch', placeholder: 'Search entries by name, key or text', value: q });
    search.addEventListener('input', function () { A.ui.lbSearch = search.value; clearTimeout(search._t); search._t = setTimeout(function () { A.rerender(); var s = document.getElementById('lbSearch'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250); });
    function match(e) { if (!q) return true; var s = (e.name + ' ' + e.keys + ' ' + e.text + ' ' + e.id + ' ' + e.group).toLowerCase(); return s.indexOf(q.toLowerCase()) !== -1; }
    function doImport(text) {
      var data; try { data = JSON.parse(text); } catch (e) { A.toast('Not valid JSON: ' + e.message); return; }
      var list = []; try { list = J.importLorebook(data); } catch (e) { A.toast('Could not read that lorebook: ' + e.message); return; }
      if (!list.length) { A.toast('No entries found in that file.'); return; }
      m.entries = m.entries.concat(list); m.enabled = true; A.changed(true); A.toast('Imported ' + list.length + ' entries');
    }
    var tools = h('div', { class: 'row' }, [
      h('div', { style: { flex: '1 1 260px', minWidth: '0' } }, search),
      h('button', { class: 'btn', type: 'button', text: 'Import file\u2026', onclick: function () { A.pickFile(A.ACCEPT, A.openImport); } }),
      h('button', { class: 'btn', type: 'button', text: 'Paste\u2026', onclick: function () { A.pasteModal('Import lore', 'Paste a lorebook (Janitor, SillyTavern, NovelAI, Agnai, RisuAI), a character card, CSV, plain-text lore, or a script. You will see a preview first.', function (t) { A.openImport({ text: t }); }); } }),
      h('button', { class: 'btn', type: 'button', text: 'Copy as Janitor Lorebook JSON', onclick: function () { A.copy(JSON.stringify(J.exportLorebook(A.P), null, 2), 'Lorebook JSON'); } }),
      h('button', { class: 'btn ghost', type: 'button', text: 'More formats\u2026', onclick: function () { A.go('io'); } })
    ]);
    var closedAll = m.entries.length > 4;
    return [
      panel('Settings', [grid([depth(m, 'Default for entries that do not set their own.'), fNum('Most entries per reply', m, 'limit', { min: 1, step: 1 }),
        fSelect('Inclusion groups pick', m, 'groupMode', [['weight', 'By weight (lottery)'], ['hits', 'Most matched keys']])]),
        fCheck('Match word forms', m, 'forms', { hint: 'A key like "goblin" also fires on "goblins", "city" on "cities", "dance" on "dancing". Regex keys are left alone.' })]),
      panel('Entries (' + m.entries.length + ')', [tools, repeater({
        items: m.entries, addLabel: 'Add entry', collapsible: true, startClosed: closedAll, filter: match,
        empty: q ? 'No entries match "' + q + '".' : 'No entries yet. Add one or import a lorebook.',
        title: function (e) { return (e.always ? '\u2605 ' : '') + (e.name || e.id); },
        sub: function (e) { return e.always ? 'always on' : (e.keys || 'no keys'); },
        make: function () { return J.newLore({ name: 'New entry' }); },
        onDup: function (c) { c.id = J.uid('lore'); c.name = (c.name || '') + ' copy'; },
        body: loreBody
      })], 'Every setting from Janitor\u2019s Lorebook editor, plus unlocks: an entry can pull in another entry when it fires.')
    ];
  };
  function loreBody(e) {
    return [
      grid([fText('Name', e, 'name'), fText('ID', e, 'id', { mono: true, hint: 'Used by unlocks and rules.' }), fSelect('Category', e, 'category', CATS.map(function (c) { return [c, cap(c)]; })), fTarget(e), prio(e)]),
      grid([fText('Keys', e, 'keys', { hint: KEYHINT }), fCheck('Always on (constant)', e, 'always', { structural: true })], 'two'),
      fText('Text', e, 'text', { area: true, rows: 3 }),
      h('details', { class: 'fold' }, [h('summary', { text: 'Matching, gates and groups' }), grid([
        fText('Secondary keys', e, 'secondary'),
        fSelect('Secondary logic', e, 'logic', [['AND_ANY', 'AND ANY'], ['AND_ALL', 'AND ALL'], ['NOT_ANY', 'NOT ANY'], ['NOT_ALL', 'NOT ALL']]),
        fCheck('Match whole words', e, 'ww'), fCheck('Case-sensitive', e, 'cs'),
        fNum('Messages scanned', e, 'depth', { min: 0, step: 1, hint: '0 = use the lorebook default.' }),
        fNum('Min messages', e, 'minMsg', { min: 0, step: 1 }), fNum('Max messages', e, 'maxMsg', { min: 0, step: 1, hint: '0 = no limit.' }),
        fNum('Probability %', e, 'prob', { min: 0, max: 100, step: 1 }),
        fText('Inclusion group', e, 'group', { hint: 'Only one entry per group fires.' }), fNum('Group weight', e, 'weight', { min: 0, step: 1 }),
        fText('Unlocks', e, 'unlocks', { mono: true, hint: 'Entry IDs to also add when this fires.' }),
        fCheck('Enabled', e, 'enabled', { structural: true }),
        fText('Comment', e, 'comment', { span: true, hint: 'Not included in the script.' })
      ])])
    ];
  }

  /* ---------- pacing ---------- */
  FORMS.pacing = function (m) {
    return [
      panel('Basics', grid([prio(m), fNum('Beat window (messages)', m, 'window', { min: 0, step: 1, hint: 'A beat stays active this many messages after its count, so a skipped count still fires.' })])),
      panel('Phases', repeater({ items: m.phases, addLabel: 'Add phase', title: function (p) { return 'Messages ' + p.from + ' to ' + (p.to || '\u221e'); },
        make: function () { return { from: 0, to: 20, text: '', target: 'scenario' }; },
        body: function (p) { return [grid([fNum('From message', p, 'from', { min: 0, step: 1 }), fNum('To message', p, 'to', { min: 0, step: 1, hint: '0 = no end.' }), fTarget(p)]), fText('Text', p, 'text', { area: true, rows: 2 })]; } }), 'Long-running context that changes as the story goes on.'),
      panel('One-time beats', repeater({ items: m.beats, addLabel: 'Add beat', title: function (b) { return 'At message ' + b.at; },
        make: function () { return { at: 20, text: '', target: 'scenario' }; },
        body: function (b) { return [grid([fNum('At message', b, 'at', { min: 0, step: 1 }), fTarget(b)]), fText('Text', b, 'text', { area: true, rows: 2 })]; } }), 'A story event that happens once, near a given message count.'),
      panel('Recurring beats', repeater({ items: m.recurring, addLabel: 'Add recurring beat', title: function (b) { return 'Every ' + b.every + ' messages'; },
        make: function () { return { every: 25, from: 0, text: '', target: 'scenario' }; },
        body: function (b) { return [grid([fNum('Every', b, 'every', { min: 1, step: 1 }), fNum('Starting after', b, 'from', { min: 0, step: 1 }), fTarget(b)]), fText('Text', b, 'text', { area: true, rows: 2 })]; } })),
      panel('Foreshadowing', repeater({ items: m.foreshadow, addLabel: 'Add foreshadowing', title: function (b) { return b.hint ? b.hint.slice(0, 50) : 'hint'; }, sub: function (b) { return b.payoffAt ? 'pays off at message ' + b.payoffAt : 'no payoff'; },
        make: function () { return { hint: '', from: 4, chance: 35, payoffAt: 30, payoff: '', target: 'scenario' }; },
        body: function (b) { return [fText('Hint', b, 'hint', { area: true, rows: 2, hint: 'A small sign of what is coming. The bot is told to hint at it, never explain it.' }),
          grid([fNum('Hints start at message', b, 'from', { min: 0, step: 1 }), fNum('Hint chance per reply %', b, 'chance', { min: 0, max: 100, step: 5 }), fNum('Payoff at message', b, 'payoffAt', { min: 0, step: 1, hint: '0 = keep hinting, no payoff.' }), fTarget(b)]),
          fText('Payoff', b, 'payoff', { area: true, rows: 2, hint: 'Happens once. Hints stop when it does.' })]; } }),
        'Plant a clue early and pay it off later, so twists feel earned instead of random.'),
      panel('Story Spine helper', storySpine(m), 'Answer the seven lines of a classic story spine. The builder turns them into phases and beats, each one caused by the last ("because of that"), instead of "and then, and then".')
    ];
  };
  function storySpine(m) {
    var sp = A.ui.spine || (A.ui.spine = { once: '', every: '', until: '', because1: '', because2: '', finally: '', ever: '', length: 60 });
    var box = h('div');
    add(box, [
      grid([fText('Once upon a time...', sp, 'once', { area: true, rows: 2, ph: 'Who and where. e.g. A smuggler runs a tavern on the border.' }),
        fText('Every day...', sp, 'every', { area: true, rows: 2, ph: 'The normal routine before things change.' }),
        fText('Until one day...', sp, 'until', { area: true, rows: 2, ph: 'The event that starts the story.' }),
        fText('Because of that...', sp, 'because1', { area: true, rows: 2, ph: 'The first consequence.' }),
        fText('Because of that...', sp, 'because2', { area: true, rows: 2, ph: 'The next consequence, bigger.' }),
        fText('Until finally...', sp, 'finally', { area: true, rows: 2, ph: 'The climax.' }),
        fText('And ever since...', sp, 'ever', { area: true, rows: 2, ph: 'How things are different now.' }),
        fNum('Story length (messages)', sp, 'length', { min: 10, step: 10, hint: 'Roughly how long you expect the chat to run.' })], 'two'),
      h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', text: 'Turn into phases and beats', onclick: function () {
        var L = Math.max(10, parseInt(sp.length, 10) || 60), q = function (f) { return Math.round(L * f / 2) * 2; };
        var t = function (x) { return String(x || '').replace(/^\s+|\s+$/g, ''); };
        if (!t(sp.until)) { A.toast('Fill in at least "Until one day..."'); return; }
        var ph = [];
        if (t(sp.once) || t(sp.every)) ph.push({ from: 0, to: q(0.15), target: 'scenario', text: 'Story so far: ' + [t(sp.once), t(sp.every)].filter(Boolean).join(' ') + ' Keep things grounded in this routine.' });
        if (t(sp.because1)) ph.push({ from: q(0.15) + 1, to: q(0.45), target: 'scenario', text: 'Because ' + t(sp.until).replace(/\.$/, '').toLowerCase() + ', now: ' + t(sp.because1) + ' Every scene should follow from what just happened ("therefore" or "but"), never "and then".' });
        if (t(sp.because2)) ph.push({ from: q(0.45) + 1, to: q(0.8), target: 'scenario', text: 'Things escalate: ' + t(sp.because2) + ' Raise the stakes; choices have consequences.' });
        if (t(sp.finally)) ph.push({ from: q(0.8) + 1, to: 0, target: 'scenario', text: 'The climax is here: ' + t(sp.finally) + (t(sp.ever) ? ' Afterwards: ' + t(sp.ever) : '') });
        m.phases = m.phases.concat(ph);
        m.beats = m.beats.concat([{ at: q(0.15), target: 'scenario', text: 'Turning point now: ' + t(sp.until) }]);
        if (t(sp.finally)) m.foreshadow = m.foreshadow.concat([{ hint: 'early signs that lead to this: ' + t(sp.finally), from: q(0.3), chance: 25, payoffAt: q(0.8), payoff: '', target: 'scenario' }]);
        m.enabled = true; A.changed(true); A.toast('Added ' + ph.length + ' phases and a turning point');
      } })])
    ]);
    return box;
  }


  /* ---------- random ---------- */
  var OUTHINT = 'One per line: text | weight. Higher weight = more likely.';
  FORMS.random = function (m) {
    return [
      panel('Basics', grid([prio(m), depth(m)])),
      panel('Keyword dice', repeater({ items: m.triggers, addLabel: 'Add dice', collapsible: true,
        title: function (t) { return t.keys || 'dice'; }, sub: function (t) { return t.chance + '%'; },
        make: function () { return { keys: 'roll, dice', chance: 100, target: 'scenario', minMsg: 0, outcomes: 'Success! | 1\nFailure. | 1' }; },
        body: function (t) { return [grid([fText('Keys', t, 'keys', { hint: KEYHINT }), fNum('Chance %', t, 'chance', { min: 0, max: 100, step: 1 }), fNum('Min messages', t, 'minMsg', { min: 0, step: 1 }), fTarget(t)]), fText('Outcomes', t, 'outcomes', { area: true, rows: 4, hint: OUTHINT })]; } }),
        'When a key appears, roll the chance, then pick exactly one outcome.'),
      panel('Random encounters', [grid([fNum('Chance per reply %', m, 'encounterChance', { min: 0, max: 100, step: 0.5, hint: '0 turns encounters off. 3 to 8 is plenty.' }), fNum('Not before message', m, 'encounterMin', { min: 0, step: 1 })]),
        fText('Encounters', m, 'encounters', { area: true, rows: 5, hint: OUTHINT })], 'Something unexpected happens now and then, with no keyword needed.'),
      panel('Real dice for the bot', [
        fCheck('Roll dice tags in the card', m, 'diceTags', { hint: 'Write <<1d20>> or <<2d6+3>> anywhere in the character\u2019s personality or scenario. Each reply, the tag becomes a real roll.' }),
        fText('Fresh dice every reply', m, 'pool', { ph: 'e.g. 1d20 x4, 3d6 x3', hint: 'Pre-rolled numbers the bot uses in order, so it never makes up a roll or reuses an old one. Leave empty for none.' })],
        'Bots are bad at randomness: they pick the same "random" numbers and repeat old rolls. These hand them real ones.')
    ];
  };

  /* ---------- stats ---------- */
  FORMS.stats = function (m) {
    var demo = (m.list || []).filter(function (x) { return x.name; }).map(function (x) { return x.name + ': ' + (x.start || 0) + (x.showMax && x.max !== '' ? '/' + x.max : ''); }).join(' | ');
    return [
      h('div', { class: 'banner', text: 'How it works: the bot ends every reply with a status line' + (demo ? ' like "' + demo + '"' : '') + '. Next reply, the script reads the numbers back from the chat, applies any changes, and hands the bot the new line. Your own messages are never read for numbers, so typing "HP: 999" doesn\u2019t cheat.' }),
      panel('Basics', [grid([fTarget(m), prio(m), fNum('Messages searched', m, 'depth', { min: 1, max: 30, step: 1, hint: 'How far back to look for the last status line.' }), fText('Label', m, 'label')]),
        fCheck('Tell the bot to write the status line', m, 'instruct', { hint: 'Keep this on unless your character card already asks for a status block in the same "Name: number" format.' })]),
      panel('Stats', repeater({ items: m.list, addLabel: 'Add stat', collapsible: true,
        title: function (x) { return x.name || 'stat'; }, sub: function (x) { return 'starts at ' + x.start; },
        make: function () { return { name: 'HP', start: 10, min: 0, max: 10, showMax: true, changes: '', low: 0, lowText: '', high: '', highText: '', enabled: true }; },
        body: function (x) { return [
          grid([fText('Name', x, 'name', { hint: 'One or two words, e.g. HP, Gold, Day.' }), fNum('Start', x, 'start', { step: 1 }), fText('Lowest', x, 'min', { hint: 'Empty = no limit.' }), fText('Highest', x, 'max', { hint: 'Empty = no limit.' })]),
          fCheck('Show as value/highest (e.g. 12/30)', x, 'showMax'),
          fText('Changes', x, 'changes', { hint: 'Words in your message that change it: "drink a potion: 10, get hit: -5".' }),
          grid([fNum('When at or below', x, 'low', { step: 1 }), fText('...add', x, 'lowText', { area: true, rows: 2 }), fNum('When at or above', x, 'high', { step: 1 }), fText('...add', x, 'highText', { area: true, rows: 2 })], 'two'),
          fCheck('Enabled', x, 'enabled', { structural: true })]; } }),
        'Rules can check any stat with a "Meter or stat value" condition.')
    ];
  };

  /* ---------- style ---------- */
  FORMS.style = function (m) {
    var n = String(m.phrases || '').split(',').filter(function (x) { return x.replace(/\s/g, ''); }).length;
    return [
      panel('Basics', grid([fTarget(m), prio(m), fNum('Phrases per reply', m, 'perTurn', { min: 0, max: 30, step: 1, hint: 'A few rotate in each reply so the list doesn\u2019t eat your size budget.' })])),
      panel('Style rules', fText('Always add', m, 'rules', { area: true, rows: 3, hint: 'General writing guidance, added every reply. Leave empty for none.' })),
      panel('Phrases to avoid (' + n + ')', [fText('Phrases', m, 'phrases', { area: true, rows: 6, hint: 'Comma-separated. Add the ones your bot overuses.' }),
        grid([fCheck('Call out phrases the bot just used', m, 'echo', { hint: 'If its last reply used one, the next reply is told to drop it by name.' }), fNum('Replies checked', m, 'depth', { min: 1, max: 10, step: 1 })], 'two'),
        h('div', { class: 'row' }, [h('button', { class: 'btn sm', type: 'button', text: 'Reset to the default list', onclick: function () { m.phrases = J.defaultProject().modules.style.phrases; m.rules = J.defaultProject().modules.style.rules; A.changed(true); } })])],
        'Worn-out phrases ("a shiver ran down", "barely above a whisper") make every bot sound the same. Use the Slop check tool to scan your card text too.')
    ];
  };

  /* ---------- ambient ---------- */
  FORMS.ambient = function (m) {
    var periods = (M('time').periods || []).map(function (p) { return p.name; }).join(', ');
    return [
      panel('Basics', grid([prio(m), fNum('Chance per reply %', m, 'chance', { min: 0, max: 100, step: 1 }), fNum('Not before message', m, 'minMsg', { min: 0, step: 1 })])),
      panel('Details', repeater({ items: m.list, addLabel: 'Add detail', title: function (a) { return a.text ? a.text.slice(0, 60) : 'detail'; }, sub: function (a) { return a.periods || 'any time'; },
        make: function () { return { text: '', weight: 1, periods: '' }; },
        body: function (a) { return [fText('Text', a, 'text', { area: true, rows: 2 }), grid([fNum('Weight', a, 'weight', { min: 0, step: 1 }), fText('Only during', a, 'periods', { hint: periods ? 'Periods: ' + periods + (M('time').enabled ? '' : ' (turn on Time to use these)') : 'Turn on Time to filter by period.' })], 'two')]; } }),
        'Small sensory touches. One may be added per reply.')
    ];
  };

  /* ---------- rules ---------- */
  var COND_TYPES = [['keyword', 'Keyword'], ['messages', 'Message count'], ['period', 'Time of day'], ['weekday', 'Weekday'], ['hour', 'Hour range'], ['emotion', 'Emotion'], ['state', 'State'], ['meter', 'Meter or stat value'], ['actor', 'Character on stage'], ['remembered', 'Remembered fact'], ['fired', 'Something else fired'], ['chance', 'Random chance']];
  function condDefaults(t) {
    return { keyword: { keys: '', mode: 'any', depth: 1 }, messages: { min: 0, max: 0 }, period: { values: '' }, weekday: { values: '' }, hour: { min: 22, max: 4 }, emotion: { values: '' }, state: { values: '' }, meter: { meter: '', min: 0, max: 100 }, actor: { values: '' }, remembered: { key: 'name' }, fired: { tag: '' }, chance: { pct: 50 } }[t] || {};
  }
  function condBody(c) {
    var P = A.P, mods = P.modules;
    var periods = mods.time.periods.map(function (p) { return p.name; }).join(', ');
    var states = mods.states.list.map(function (s) { return s.name; }).join(', ');
    var meters = mods.scoring.meters.map(function (x) { return x.name; }).concat((mods.stats.list || []).map(function (x) { return String(x.name || '').replace(/[:=|]/g, '').replace(/^\s+|\s+$/g, ''); })).filter(Boolean);
    var cast = mods.ensemble.cast.map(function (a) { return a.name; }).join(', ');
    var facts = ['name', 'likes', 'dislikes', 'fears'].concat(mods.memory.facts.map(function (f) { return f.label; })).join(', ');
    switch (c.type) {
      case 'keyword': return [fText('Keys', c, 'keys', { hint: KEYHINT }), fSelect('Match', c, 'mode', [['any', 'Any of them'], ['all', 'All of them'], ['none', 'None of them']]), fNum('Messages scanned', c, 'depth', { min: 1, step: 1 })];
      case 'messages': return [fNum('From message', c, 'min', { min: 0, step: 1 }), fNum('To message', c, 'max', { min: 0, step: 1, hint: '0 = no end.' })];
      case 'period': return [fText('Any of', c, 'values', { hint: periods ? 'Periods: ' + periods : 'Set up periods in Time.' })];
      case 'weekday': return [fText('Any of', c, 'values', { hint: 'monday, tuesday, ... sunday' })];
      case 'hour': return [fNum('From hour', c, 'min', { min: 0, max: 23, step: 1 }), fNum('To hour', c, 'max', { min: 0, max: 24, step: 1, hint: 'Wraps past midnight.' })];
      case 'emotion': return [fText('Any of', c, 'values', { hint: J.EMOTIONS.join(', ') })];
      case 'state': return [fText('Any of', c, 'values', { hint: states ? 'States: ' + states + ' (add + for escalated)' : 'Set up states first.' })];
      case 'meter': return [meters.length ? fSelect('Meter', c, 'meter', [['', 'Choose\u2026']].concat(meters.map(function (x) { return [x, x]; }))) : fText('Meter', c, 'meter', { hint: 'Add a meter or a stat first.' }), fNum('At least', c, 'min'), fNum('At most', c, 'max')];
      case 'actor': return [fText('Any of', c, 'values', { hint: cast ? 'Cast: ' + cast : 'Add cast members first.' })];
      case 'remembered': return [fText('Fact', c, 'key', { hint: facts })];
      case 'fired': return [fText('Tag', c, 'tag', { mono: true, hint: 'e.g. lore:dragon, state:conflict, beat:16, encounter, rule:late_confession' })];
      case 'chance': return [fNum('Chance %', c, 'pct', { min: 0, max: 100, step: 1 })];
    }
    return [];
  }
  FORMS.rules = function (m) {
    return [panel('Rules', repeater({
      items: m.list, addLabel: 'Add rule', collapsible: true,
      title: function (r) { return r.name || 'rule'; },
      sub: function (r) { return (r.match === 'any' ? 'any of ' : 'all of ') + (r.conds || []).length + ' conditions'; },
      make: function () { return { name: 'rule_' + (m.list.length + 1), match: 'all', conds: [{ type: 'keyword', keys: '', mode: 'any', depth: 1 }], text: '', target: 'scenario', prio: 75 }; },
      body: function (r) {
        return [
          grid([fText('Name', r, 'name', { mono: true, hint: 'Other rules can check "rule:name".' }), fSelect('Fires when', r, 'match', [['all', 'All conditions are true'], ['any', 'Any condition is true']]), fTarget(r), prio(r)]),
          h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Conditions' }), repeater({
            items: r.conds, addLabel: 'Add condition', noDup: true,
            title: function (c) { return (COND_TYPES.filter(function (t) { return t[0] === c.type; })[0] || [0, c.type])[1]; },
            make: function () { return Object.assign({ type: 'keyword' }, condDefaults('keyword')); },
            body: function (c) {
              return [grid([fSelect('Type', c, 'type', COND_TYPES, { structural: true, onChange: function (v) { var d = condDefaults(v); Object.keys(c).forEach(function (k) { if (k !== 'type') delete c[k]; }); Object.assign(c, d); } })].concat(condBody(c)))];
            }
          })]),
          fText('Then add', r, 'text', { area: true, rows: 3 })
        ];
      }
    }), 'IF this AND that THEN add text. Rules run last, so they can check time, mood, state, meters, cast, memory and what else fired this reply.')];
  };

  function pad(n) { n = parseInt(n, 10) || 0; return (n < 10 ? '0' : '') + n; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  A.cap = cap;
})(App);
