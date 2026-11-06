/* JSB app: Import & Export page, import preview and the file formats. */
(function (A) {
  'use strict';
  var h = A.h, J = A.JSB, IO = window.JSBIO;

  /* ---------- import: detect, preview, apply ---------- */
  A.openImport = function (input) {
    var plan;
    try { plan = IO.detect(input); } catch (e) { plan = { kind: 'none', error: String(e && e.message || e) }; }
    preview(plan, input);
  };

  function modal(title, kids) {
    var bg = h('div', { class: 'modal-bg', onclick: function (e) { if (e.target === bg) close(); } });
    var box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [h('h3', { text: title })]);
    A.add(box, kids(close));
    bg.appendChild(box);
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.appendChild(bg);
    var first = box.querySelector('button.primary'); if (first) first.focus();
    return close;
  }
  function radio(name, opts, value, onChange) {
    var box = h('div', { class: 'f' });
    opts.forEach(function (o, i) {
      var id = name + i;
      var r = h('input', { type: 'radio', name: name, id: id, value: o[0] }); r.checked = o[0] === value;
      r.addEventListener('change', function () { if (r.checked) onChange(o[0]); });
      box.appendChild(h('label', { class: 'chk', for: id }, [r, h('span', null, [o[1], o[2] ? h('span', { class: 'hint', text: o[2] }) : null])]));
    });
    return box;
  }
  function check(id, label, val, onChange, hint) {
    var c = h('input', { type: 'checkbox', id: id }); c.checked = val;
    c.addEventListener('change', function () { onChange(c.checked); });
    return h('label', { class: 'chk', for: id }, [c, h('span', null, [label, hint ? h('span', { class: 'hint', text: hint }) : null])]);
  }
  function lorePreview(entries) {
    var list = h('div', { class: 'out', style: { maxHeight: '220px' } });
    list.textContent = entries.slice(0, 40).map(function (e) { return '\u2022 ' + (e.name || e.id) + (e.always ? '  [always on]' : e.keys ? '  [' + e.keys.slice(0, 60) + ']' : '') + '\n    ' + e.text.replace(/\s+/g, ' ').slice(0, 110); }).join('\n') + (entries.length > 40 ? '\n\u2026 and ' + (entries.length - 40) + ' more' : '');
    return list;
  }
  function done(msg, view) { A.changed(true); if (view) A.go(view); A.toast(msg); }

  function preview(plan, input) {
    var P = A.P, name = input && input.name ? input.name : '';
    if (plan.kind === 'none') {
      modal('Nothing imported', function (close) {
        return [h('div', { class: 'banner bad', text: plan.error || 'This could not be read.' }),
          h('p', { class: 'small', text: 'The builder can import: project files and project codes, scripts saved from this builder, character cards (PNG or JSON, V1/V2/V3), lorebooks from Janitor, SillyTavern, character cards, NovelAI, Agnai and RisuAI, CSV spreadsheets, plain-text lore, and the lore inside other Janitor scripts.' }),
          h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', text: 'OK', onclick: close }))];
      });
      return;
    }
    if (plan.kind === 'project') {
      var np = plan.project, lore = np.modules.lorebook.entries.length, on = J.MODULE_IDS.filter(function (id) { return np.modules[id].enabled; });
      modal('Open project?', function (close) {
        return [h('p', null, [h('b', { text: plan.label }), name ? h('span', { class: 'muted', text: ' (' + name + ')' }) : null]),
          h('div', { class: 'stats' }, [stat(np.meta.title || 'Untitled', 'title'), stat(on.length, 'features on'), stat(lore, 'lore entries'), stat(np.modules.ensemble.cast.length, 'cast')]),
          on.length ? h('p', { class: 'small', text: 'Features: ' + on.map(function (id) { return A.FRIENDLY && A.FRIENDLY[id] ? A.FRIENDLY[id][0] : id; }).join(', ') + '.' }) : null,
          plan.fromScript ? h('p', { class: 'small muted', text: 'Every setting was read back from the script, so you can keep editing it here. Changes made by hand below the ENGINE line of the script are not kept.' }) : null,
          h('div', { class: 'banner ok', text: 'It opens as a new project. "' + (P.meta.title || 'Untitled') + '" stays in My projects.' }),
          h('div', { class: 'row end' }, [
            h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close }),
            h('button', { class: 'btn primary', type: 'button', text: 'Open as a new project', onclick: function () { close(); A.newProject(np, { source: 'import' }); A.go('quick'); A.toast('Opened ' + (np.meta.title || 'project')); } })
          ])];
      });
      return;
    }
    if (plan.kind === 'script' && plan.project) {
      var cp = plan.project, f = plan.found || {}, M = cp.modules, bits = [];
      function cnt(n, one, many) { if (n) bits.push(n + ' ' + (n === 1 ? one : many)); }
      cnt(M.lorebook.entries.filter(function (e) { return !e.always; }).length, 'lore entry', 'lore entries');
      cnt(M.lorebook.entries.filter(function (e) { return e.always; }).length, 'always-on text', 'always-on texts');
      cnt(M.states.list.length, 'mood/state', 'moods/states');
      cnt(M.rules.list.length, 'combined rule', 'combined rules');
      cnt(M.pacing.phases.length, 'story phase', 'story phases');
      if (M.stats.list.length) bits.push('stats (' + M.stats.list.map(function (x) { return x.name; }).join(', ') + ')');
      if (f.memory) bits.push('name memory');
      if (f.recap) bits.push('recaps');
      if (f.time) bits.push('time of day');
      if (f.mood) bits.push('mood reading');
      var onIds = J.MODULE_IDS.filter(function (id) { return M[id].enabled; });
      modal('Convert this script', function (close) {
        var kids = [h('p', null, [h('b', { text: plan.label }), name ? h('span', { class: 'muted', text: ' (' + name + ')' }) : null]),
          h('p', { class: 'small', text: 'This script was made somewhere else. The builder read its keyword checks, message counts, time checks and chances and turned them into: ' + bits.join(', ') + '.' }),
          h('p', { class: 'small muted', text: 'Features: ' + onIds.map(function (id) { return A.FRIENDLY && A.FRIENDLY[id] ? A.FRIENDLY[id][0] : id; }).join(', ') + '. Check them over: anything the builder could not read' + (f.skipped ? ' (' + f.skipped + ' piece' + (f.skipped === 1 ? '' : 's') + ')' : '') + ' was left out.' })];
        if (plan.entries.length) kids.push(lorePreview(plan.entries));
        kids.push(h('div', { class: 'banner ok', text: 'It opens as a new project. "' + (P.meta.title || 'Untitled') + '" stays in My projects.' }));
        kids.push(h('div', { class: 'row end' }, [
          h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close }),
          h('button', { class: 'btn', type: 'button', text: 'Open in ES5 checker', onclick: function () { close(); A.checkState.code = plan.code; A.checkState.result = null; A.checkState.fixed = null; A.saveNow(); A.go('check'); } }),
          plan.entries.length ? h('button', { class: 'btn', type: 'button', text: 'Only add its lore here', onclick: function () { close(); A.P = IO.mergeLore(A.P, plan.entries, 'append'); A.compileNow(); done('Added ' + plan.entries.length + ' entries', 'mod-lorebook'); } }) : null,
          h('button', { class: 'btn primary', type: 'button', text: 'Open as a new project', onclick: function () { close(); A.newProject(cp, { source: 'import' }); A.go('quick'); A.toast('Converted ' + (cp.meta.title || 'script')); } })
        ]));
        return kids;
      });
      return;
    }
    if (plan.kind === 'card') {
      var c = plan.card, o = { fields: true, lore: plan.entries.length > 0, mode: 'append', where: 'new' };
      modal('Import character card', function (close) {
        return [h('p', null, [h('b', { text: plan.label })]),
          c.description ? h('div', { class: 'out', style: { maxHeight: '110px' }, text: c.description.slice(0, 600) + (c.description.length > 600 ? '\u2026' : '') }) : null,
          check('ioFields', 'Use the name, personality and scenario', true, function (v) { o.fields = v; }, 'Fills Card blocks and the project name. The description and first message go into Notes.'),
          plan.entries.length ? check('ioLore', 'Import the card\u2019s lorebook (' + plan.entries.length + (plan.entries.length === 1 ? ' entry)' : ' entries)'), true, function (v) { o.lore = v; }, 'On Janitor a lorebook is a script, so this is how a card\u2019s lore actually reaches the bot.') : h('p', { class: 'muted small', text: 'This card has no lorebook.' }),
          plan.entries.length ? lorePreview(plan.entries) : null,
          radio('ioWhere', [['new', 'Make it a new project', 'The project you have open stays in My projects.'], ['here', 'Add it to this project']], 'new', function (v) { o.where = v; }),
          plan.entries.length ? radio('ioMode', [['append', 'Add to the lorebook'], ['replace', 'Replace the lorebook']], 'append', function (v) { o.mode = v; }) : null,
          h('div', { class: 'row end' }, [h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close }),
            h('button', { class: 'btn primary', type: 'button', text: 'Import', onclick: function () {
              close();
              if (o.where !== 'here') {
                var base = J.defaultProject();
                ['memory', 'emotions', 'style'].forEach(function (id) { base.modules[id].enabled = true; });
                base.meta.title = c.name || 'Imported card';
                A.newProject(IO.applyCard(base, c, { fields: true, lore: o.lore, replaceLore: false }), { source: 'card' });
                A.go(o.lore && plan.entries.length ? 'mod-lorebook' : 'quick');
                A.toast('Opened ' + (c.name || 'card') + ' as a new project');
                return;
              }
              var np2 = IO.applyCard(A.P, c, { fields: o.fields, lore: o.lore, replaceLore: o.mode === 'replace' });
              A.P = np2; A.compileNow();
              done('Imported ' + (c.name || 'card') + (o.lore && plan.entries.length ? ' with ' + plan.entries.length + (plan.entries.length === 1 ? ' lore entry' : ' lore entries') : ''), o.lore && plan.entries.length ? 'mod-lorebook' : 'card');
            } })])];
      });
      return;
    }
    if (plan.kind === 'lorebook' || plan.kind === 'script') {
      var entries = plan.entries || [], mode = 'append';
      modal(plan.kind === 'script' ? 'Import from a script' : 'Import lorebook', function (close) {
        var kids = [h('p', null, [h('b', { text: plan.label }), name ? h('span', { class: 'muted', text: ' (' + name + ')' }) : null])];
        if (plan.kind === 'script') {
          kids.push(h('p', { class: 'small muted', text: entries.length ? 'This script was not made with the builder, so only its lore-style entries (keywords plus text) can be brought in. You can also check or test the whole script.' : 'This script was not made with the builder and no lore-style entries were found in it. You can still check it for ES5 problems or run it in the tester.' }));
        }
        if (entries.length) {
          kids.push(h('p', { class: 'small', text: entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + ' found. Your lorebook has ' + P.modules.lorebook.entries.length + '.' }));
          kids.push(lorePreview(entries));
          kids.push(radio('ioMode2', [['append', 'Add to this project\u2019s lorebook', 'Duplicate IDs get a number added.'], ['new', 'Make it a new project', 'The project you have open stays in My projects.'], ['replace', 'Replace this project\u2019s lorebook']], 'append', function (v) { mode = v; }));
        }
        var btns = [h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close })];
        if (plan.kind === 'script') {
          btns.push(h('button', { class: 'btn', type: 'button', text: 'Open in ES5 checker', onclick: function () { close(); A.checkState.code = plan.code; A.checkState.result = null; A.checkState.fixed = null; A.go('check'); } }));
          btns.push(h('button', { class: 'btn', type: 'button', text: 'Run in tester', onclick: function () { close(); A.test.source = 'custom'; A.test.custom = plan.code; A.go('test'); } }));
        }
        if (entries.length) btns.push(h('button', { class: 'btn primary', type: 'button', text: 'Import ' + entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies'), onclick: function () {
          close();
          if (mode === 'new') {
            var base = J.defaultProject(); base.meta.title = (name || 'Imported lorebook').replace(/\.[a-z0-9]+$/i, '');
            A.newProject(IO.mergeLore(base, entries, 'append'), { source: 'lorebook' }); A.go('mod-lorebook'); A.toast('Opened ' + entries.length + ' entries as a new project');
            return;
          }
          A.P = IO.mergeLore(A.P, entries, mode); A.compileNow();
          done((mode === 'replace' ? 'Replaced the lorebook with ' : 'Added ') + entries.length + ' entries', 'mod-lorebook');
        } }));
        kids.push(h('div', { class: 'row end' }, btns));
        return kids;
      });
    }
  }
  function stat(v, l) { return h('div', { class: 'stat' }, [h('b', { text: String(v), style: { fontSize: 'var(--t-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }), h('span', { text: l })]); }

  /* ---------- PNG card image (drawn locally) ---------- */
  function cardPng(cb) {
    var P = A.P, nm = (P.card.name || P.meta.character || P.meta.title || 'Character').trim();
    var cv = document.createElement('canvas'); cv.width = 400; cv.height = 600;
    var g = cv.getContext('2d');
    var hue = 0; for (var i = 0; i < nm.length; i++) hue = (hue * 31 + nm.charCodeAt(i)) % 360;
    var gr = g.createLinearGradient(0, 0, 400, 600);
    gr.addColorStop(0, 'hsl(' + hue + ',45%,32%)'); gr.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',50%,16%)');
    g.fillStyle = gr; g.fillRect(0, 0, 400, 600);
    var initials = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 150px Georgia, serif'; g.fillText(initials, 200, 260);
    g.font = '600 30px Georgia, serif'; g.fillText(nm.length > 22 ? nm.slice(0, 21) + '\u2026' : nm, 200, 430);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '16px system-ui, sans-serif'; g.fillText('JanitorAI Script Builder', 200, 560);
    function fromBytes(bytes) {
      try { cb(null, IO.pngWithCard(bytes, IO.v2Card(P), IO.v3Card(P))); } catch (e) { cb(e); }
    }
    try {
      if (cv.toBlob) cv.toBlob(function (b) { if (!b) { cb(new Error('Could not draw the image.')); return; } var r = new FileReader(); r.onload = function () { fromBytes(new Uint8Array(r.result)); }; r.readAsArrayBuffer(b); }, 'image/png');
      else fromBytes(IO.b64ToBytes(cv.toDataURL('image/png').split(',')[1]));
    } catch (e) { cb(e); }
  }
  A.cardPng = cardPng;

  /* ---------- the page ---------- */
  A.views.io = function () {
    var P = A.P, slug = J.slug(P.meta.title || 'project') || 'project';
    var view = h('div', { class: 'view' });
    view.appendChild(h('div', { class: 'head' }, h('div', { class: 't' }, [h('h1', { text: 'Import & export' }), h('p', { class: 'lede', text: 'Bring in projects, character cards and lorebooks from almost anywhere, and take your work out in every format Janitor and other tools use. Everything stays on this device.' })])));

    /* import */
    var drop = h('div', { class: 'dropzone', id: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Choose a file to import' }, [
      h('b', { text: 'Drop a file here' }), h('span', { class: 'muted small', text: 'or' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Choose a file\u2026', onclick: function (e) { e.stopPropagation(); A.pickFile(A.ACCEPT, A.openImport); } }),
      h('span', { class: 'muted tiny', text: '.json \u00b7 .png card \u00b7 .js \u00b7 .csv \u00b7 .txt \u00b7 .md' })
    ]);
    drop.addEventListener('click', function () { A.pickFile(A.ACCEPT, A.openImport); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); A.pickFile(A.ACCEPT, A.openImport); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function () { drop.classList.remove('over'); });
    var paste = h('textarea', { id: 'ioPaste', rows: 6, class: 'mono', spellcheck: 'false', placeholder: 'Or paste anything here: a project code (JSB1:\u2026), project or card JSON, a lorebook, a CSV, plain-text lore, or a script.' });
    var formats = ['Builder project (.json)', 'Project code', 'Scripts saved with project data', 'Character card PNG (V1/V2/V3)', 'Character card JSON', 'Janitor Lorebook JSON', 'SillyTavern World Info', 'NovelAI lorebook', 'Agnai memory book', 'RisuAI lorebook', 'CSV / TSV spreadsheet', 'Plain-text lore', 'Lore inside any Janitor script'];
    view.appendChild(A.panel('Import', [
      drop,
      paste,
      h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', text: 'Import pasted text', onclick: function () { if (!paste.value.trim()) { A.toast('Paste something first.'); return; } A.openImport({ text: paste.value }); } }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Clear', onclick: function () { paste.value = ''; } })]),
      h('div', { class: 'f' }, [h('span', { class: 'l', text: 'Recognised automatically' }), h('div', { class: 'chips' }, formats.map(function (f) { return h('span', { class: 'tag', text: f }); }))]),
      h('details', { class: 'fold' }, [h('summary', { text: 'Plain-text and CSV layouts' }), h('div', { class: 'prose small' }, [
        h('p', { text: 'Plain text: start each entry with a heading line, then optional settings, then the text.' }),
        h('pre', { class: 'snippet', text: '## The Old Mill\nKeys: mill, old mill, waterwheel\nGroup: places\nThe mill burned down ten years ago.\n\n## House rules\nAlways: yes\n{{char}} never lets a fight start inside.' }),
        h('p', { text: 'Or just paragraphs: "Dragon: A red dragon lives in the hills." becomes an entry named Dragon, triggered by "dragon".' }),
        h('p', { text: 'CSV: a header row with at least a text (or content) column. Optional columns: name, keys, secondary, logic, group, weight, prob, minMsg, maxMsg, depth, always, target, prio. Commas, semicolons and tabs all work.' })
      ])])
    ], 'Files are read on this device only. You always see a preview before anything changes.'));

    /* export */
    var lore = P.modules.lorebook.entries.length;
    var rows = h('div', { class: 'items' });
    function row(title, desc, getText, file, opts) {
      opts = opts || {};
      var disabled = opts.disabled;
      var btns = [];
      if (!opts.noCopy) btns.push(h('button', { class: 'btn sm primary', type: 'button', text: 'Copy', disabled: disabled, onclick: function () { A.copy(getText(), title); } }));
      if (file) btns.push(h('button', { class: 'btn sm', type: 'button', text: opts.saveLabel || 'Save file', disabled: disabled, onclick: opts.onSave || function () { A.save(file, getText(), { type: opts.type }); } }));
      if (!opts.noShow) btns.push(h('button', { class: 'btn sm ghost', type: 'button', text: 'Show', disabled: disabled, onclick: function () { A.textModal(title, getText()); } }));
      rows.appendChild(h('div', { class: 'exrow' }, [h('div', { class: 'ext' }, [h('b', { text: title }), h('span', { class: 'muted small', text: disabled ? opts.disabledText || desc : desc }), file && !disabled ? h('span', { class: 'mono tiny muted', text: file }) : null, opts.extra || null]), h('div', { class: 'row' }, btns)]));
    }
    function compiled() { return A.compiled || J.compile(P); }
    var embedBox = A.fCheck('Include project data so this .js can be imported back later', P.settings, 'embed', { hint: 'Adds one comment line at the end. Janitor ignores it; this builder reads it.' });
    var scripts = compiled().scripts;
    if (scripts.length > 1) {
      scripts.forEach(function (sc, i) {
        row('Script ' + (i + 1) + ': ' + sc.title, 'Split mode: one Advanced script per module group. Assign all of them.', function () { return A.scriptCode(i); }, slug + '-' + sc.name + '.js', { type: 'text/javascript', extra: i === 0 ? embedBox : null });
      });
    } else {
      row('Janitor script (.js)', 'The Advanced script to paste into Janitor.', function () { return A.scriptCode(); }, slug + '.js', { type: 'text/javascript', extra: embedBox });
    }
    row('Project file', 'Everything in this project. Use it to back up, share, or move to another device.', function () { return IO.projectJSON(A.P); }, slug + '.jsb.json', { type: 'application/json' });
    row('Project code', 'The whole project as one line of text. Paste it into the Import box on any device, even in a chat message.', function () { return IO.projectCode(A.P); }, null);
    row('Janitor Lorebook JSON', 'For a Lorebook-type script on Janitor: open its JSON editor (<>) and paste this.', function () { return JSON.stringify(J.exportLorebook(A.P), null, 2); }, slug + '-janitor-lorebook.json', { type: 'application/json', disabled: !lore, disabledText: 'Add lorebook entries first.' });
    row('SillyTavern World Info', 'A World Info file for SillyTavern and tools that read its format.', function () { return JSON.stringify(IO.stWorldInfo(A.P), null, 2); }, slug + '-world-info.json', { type: 'application/json', disabled: !lore, disabledText: 'Add lorebook entries first.' });
    row('Character card (JSON, V2)', 'Card Blocks as personality and scenario, plus the lorebook and this project (so it re-imports fully).', function () { return JSON.stringify(IO.v2Card(A.P), null, 2); }, slug + '-card.json', { type: 'application/json' });
    row('Character card (PNG, V2 + V3)', 'A card image with the same data embedded, the format most card sites and apps use. You can swap the picture later in any card editor.', null, slug + '-card.png', { noCopy: true, noShow: true, saveLabel: 'Save image', onSave: function () {
      cardPng(function (err, bytes) { if (err) { A.toast('Could not make the image: ' + err.message); return; } A.save(slug + '-card.png', new Blob([bytes], { type: 'image/png' }), { type: 'image/png' }); });
    } });
    row('Lorebook spreadsheet (CSV)', 'Open in Excel or Google Sheets, edit, and import it back.', function () { return IO.loreCSV(A.P); }, slug + '-lorebook.csv', { type: 'text/csv', disabled: !lore, disabledText: 'Add lorebook entries first.' });
    row('Lorebook as plain text', 'Easy to read and edit anywhere; imports back as-is.', function () { return IO.loreText(A.P); }, slug + '-lorebook.txt', { disabled: !lore, disabledText: 'Add lorebook entries first.' });
    row('Card blocks (text)', 'The Personality and Scenario field text from Card blocks.', function () { return IO.cardBlocksText(A.P); }, slug + '-card-blocks.txt');
    view.appendChild(A.panel('Export', rows, window.JSB_HOSTED ? 'Saving asks for your OK first. If a save or copy is blocked, the text opens in a box you can copy from.' : 'If a save or copy is blocked, the text opens in a box you can copy from.'));
    return view;
  };
})(App);
