/* Import / export round trips. */
'use strict';
var J = require('../src/generator.js'), IO = require('../src/io.js'), PRESETS = require('../src/presets.js'), fs = require('fs'), path = require('path');
var fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log('  FAIL: ' + m); } }
function same(a, b) { return JSON.stringify(J.normalize(a)) === JSON.stringify(J.normalize(b)); }
function loreSig(list) { return list.map(function (e) { return [J.splitKeys(e.keys).join(','), e.text.trim(), e.always, e.group, e.prob, e.logic, J.splitKeys(e.secondary).join(',')].join('|'); }).join('\n'); }
var TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

PRESETS.forEach(function (pr) {
  var p = pr.make();
  p.meta.title += ' \u00e9\u6771\ud83d\ude00 "quoted"';
  var d = IO.detect({ text: IO.projectJSON(p), name: 'x.json' });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': project JSON round trip');
  d = IO.detect({ text: IO.projectCode(p) });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': project code round trip');
  d = IO.detect({ text: '  \n' + IO.projectCode(p).replace(/(.{60})/g, '$1\n') + '\n' });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': wrapped project code');
  var js = IO.scriptText(p, null, { embed: true });
  d = IO.detect({ text: js, name: 'script.js' });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': script with embed round trip');
  require('acorn').parse(js, { ecmaVersion: 5 }); ok(true);
  var card = IO.v2Card(p);
  d = IO.detect({ text: JSON.stringify(card) });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': V2 card with project round trip');
  var bare = JSON.parse(JSON.stringify(card)); delete bare.data.extensions.jsb_project;
  d = IO.detect({ text: JSON.stringify(bare) });
  ok(d.kind === 'card' && d.card.name === card.data.name && loreSig(d.entries) === loreSig(J.normalize(p).modules.lorebook.entries), pr.id + ': bare V2 card lore round trip');
  var v3 = IO.v3Card(p); delete v3.data.extensions.jsb_project;
  d = IO.detect({ text: JSON.stringify(v3) });
  ok(d.kind === 'card' && loreSig(d.entries) === loreSig(J.normalize(p).modules.lorebook.entries), pr.id + ': V3 card');
  var png = IO.pngWithCard(new Uint8Array(TINY_PNG), card, IO.v3Card(p));
  d = IO.detect({ bytes: png, name: 'card.png' });
  ok(d.kind === 'project' && same(d.project, p), pr.id + ': PNG card round trip');
  var png2 = IO.pngWithCard(png, bare, null);
  ok(Object.keys(IO.pngTextChunks(png2)).join() === 'chara', pr.id + ': PNG re-embed replaces old chunks');
  var lore = J.normalize(p).modules.lorebook.entries;
  if (!lore.length) return;
  d = IO.detect({ text: JSON.stringify(IO.stWorldInfo(p)), name: 'world.json' });
  ok(d.kind === 'lorebook' && loreSig(d.entries) === loreSig(lore), pr.id + ': SillyTavern World Info round trip\n' + loreSig(d.entries) + '\n---\n' + loreSig(lore));
  d = IO.detect({ text: JSON.stringify(J.exportLorebook(p)) });
  ok(d.kind === 'lorebook' && loreSig(d.entries) === loreSig(lore), pr.id + ': Janitor lorebook JSON round trip');
  d = IO.detect({ text: IO.loreCSV(p), name: 'lore.csv' });
  ok(d.kind === 'lorebook' && loreSig(d.entries) === loreSig(lore), pr.id + ': CSV round trip');
  d = IO.detect({ text: IO.loreCSV(p) });
  ok(d.kind === 'lorebook', pr.id + ': CSV detected without a file name');
  d = IO.detect({ text: IO.loreText(p), name: 'lore.txt' });
  ok(d.kind === 'lorebook' && d.entries.length === lore.length && d.entries.every(function (e, i) { return e.text === lore[i].text.trim() && e.always === lore[i].always; }), pr.id + ': plain text round trip');
});

/* Tricky CSV */
var csv = 'Name;Keywords;Content;Probability\n"Odd, name";"a, b";"Line one\nline ""two""";50\n';
var d = IO.detect({ text: csv, name: 'x.csv' });
ok(d.kind === 'lorebook' && d.entries[0].name === 'Odd, name' && d.entries[0].text === 'Line one\nline "two"' && d.entries[0].prob === 50 && d.entries[0].keys === 'a, b', 'semicolon CSV with quotes: ' + JSON.stringify(d.entries && d.entries[0]));
/* Paragraph text */
d = IO.detect({ text: 'Dragon: A red dragon lives in the hills.\n\nThe Old Mill: Abandoned for years.\n' });
ok(d.kind === 'lorebook' && d.entries.length === 2 && d.entries[0].keys === 'dragon' && d.entries[1].keys === 'the old mill', 'paragraph text: ' + JSON.stringify(d.entries));
/* [Bracket] headings */
d = IO.detect({ text: '[Castle]\nKeys: castle, keep\nAn old keep.\n[King]\nAlways: yes\nThe king is ill.' });
ok(d.kind === 'lorebook' && d.entries.length === 2 && d.entries[1].always && d.entries[0].keys === 'castle, keep', 'bracket headings');
/* Other apps */
d = IO.detect({ text: JSON.stringify({ lorebookVersion: 5, entries: [{ text: 'NAI text', keys: ['nai'], displayName: 'NAI', enabled: true }] }) });
ok(d.kind === 'lorebook' && d.label === 'NovelAI lorebook' && d.entries[0].text === 'NAI text' && d.entries[0].name === 'NAI', 'NovelAI');
d = IO.detect({ text: JSON.stringify({ kind: 'memory', name: 'Book', entries: [{ name: 'Ag', entry: 'Agnai text', keywords: ['ag', 'agn'], priority: 5, weight: 3, enabled: true }] }) });
ok(d.kind === 'lorebook' && d.entries[0].text === 'Agnai text' && d.entries[0].keys === 'ag, agn' && d.entries[0].prio === 5, 'Agnai');
d = IO.detect({ text: JSON.stringify({ type: 'risu', ver: 1, data: [{ key: 'ri, su', content: 'Risu text', comment: 'R', alwaysActive: true, secondkey: '', selective: false }] }) });
ok(d.kind === 'lorebook' && d.entries[0].always && d.entries[0].keys === 'ri, su', 'Risu');
d = IO.detect({ text: JSON.stringify({ name: 'Old Bot', description: 'desc', personality: 'grumpy', scenario: 'a cave', first_mes: 'Hi' }) });
ok(d.kind === 'card' && d.card.name === 'Old Bot', 'V1 card');
var applied = IO.applyCard(J.defaultProject(), d.card, {});
ok(applied.card.name === 'Old Bot' && applied.card.psych === 'grumpy' && /desc/.test(applied.meta.notes), 'applyCard fields');
/* Lore from an old hand-written script */
var old = fs.readFileSync(require('path').join(__dirname, 'fixtures/old-hand-written-script.js'), 'utf8');
d = IO.detect({ text: old, name: 'old.js' });
ok(d.kind === 'script' && d.entries.length >= 3 && d.entries.some(function (e) { return /Rusty Lantern/.test(e.text); }), 'lore from old script: ' + (d.entries && d.entries.length));
d = IO.detect({ text: 'const lore = [{ keywords: ["moon", "night sky"], personality: "{{char}} loves the moon.", scenario: "The moon is full.", minMessages: 5, probability: 0.5 }];\ncontext.character.scenario += "";' });
ok(d.kind === 'script' && d.entries.length === 2 && d.entries[0].minMsg === 5 && d.entries[0].prob === 50 && d.entries[0].target === 'personality', 'lore from modern script: ' + JSON.stringify(d.entries));
/* scripts made with this builder come back as whole projects (no embed needed) */
PRESETS.forEach(function (pr) {
  [{}, { engine: 'readable' }, { split: true }].forEach(function (variant) {
    var p = pr.make(); Object.assign(p.settings, variant);
    var c1 = J.compile(p);
    if (!c1.modules.length) return;
    var d2 = IO.detect({ text: c1.code, name: 'made.js' });
    ok(d2.kind === 'project' && d2.fromScript, pr.id + ' ' + JSON.stringify(variant) + ': builder script detected as a project');
    if (d2.kind !== 'project') return;
    if (variant.split) d2.project.meta.title = p.meta.title;
    ok(J.compile(d2.project).code === c1.code, pr.id + ' ' + JSON.stringify(variant) + ': builder script -> project -> same script');
    ok(d2.project.modules.lorebook.entries.length === J.normalize(p).modules.lorebook.entries.filter(function (e) { return e.enabled !== false && e.text.trim(); }).length, pr.id + ': lore entries are not invented from states or rules');
  });
});
/* reformatted builder script (as a code formatter would leave it) */
var tav = J.compile(PRESETS.filter(function (x) { return x.id === 'tavern'; })[0].make()).code;
var reform = tav.replace(/\n  /g, '\n      ').replace(/\[\{ /g, '[\n{\n');
d = IO.detect({ text: reform, name: 'reformatted.js' });
ok(d.kind === 'project' && J.compile(d.project).code === tav, 'reformatted builder script still reads back');
/* scripts made elsewhere are converted, not just mined for lore */
var ifs = fs.readFileSync(path.join(__dirname, 'fixtures/if-style-script.js'), 'utf8');
d = IO.detect({ text: ifs, name: 'luna.js' });
var CM = d.project && d.project.modules;
ok(d.kind === 'script' && CM, 'if-style script converts to a project');
if (CM) {
  ok(CM.lorebook.entries.some(function (e) { return e.keys === 'forest, woods' && /old forest/.test(e.text); }), 'OR keyword checks become one lore entry');
  ok(CM.lorebook.entries.some(function (e) { return e.always && /curious red fox/.test(e.text); }), 'unconditional text becomes always-on lore');
  ok(CM.lorebook.entries.some(function (e) { return e.keys === 'dragon' && e.prob === 30; }), 'chance becomes lore probability');
  ok(CM.states.list.some(function (x) { return x.name === 'flustered' && x.keys === 'hug, cuddle' && /ears go flat/.test(x.text); }), 'mood variable becomes a state with its keywords');
  ok(CM.pacing.phases.some(function (x) { return x.from === 31 && x.to === 60; }), 'message-count range becomes a story phase');
  ok(CM.rules.list.some(function (r) { return r.conds.length === 1 && r.conds[0].type === 'hour' && r.conds[0].min === 22 && r.conds[0].max === 5; }), 'night check wraps past midnight');
  ok(CM.rules.list.some(function (r) { return r.conds.some(function (c) { return c.type === 'keyword' && c.keys === 'breakfast'; }) && r.conds.some(function (c) { return c.type === 'hour' && c.min === 6 && c.max === 10; }); }), 'keyword AND hour becomes a rule');
  ok(CM.stats.list.some(function (x) { return x.name === 'HP'; }) && CM.stats.enabled, 'status-line regex becomes a stat');
  ok(CM.memory.enabled && CM.time.enabled, 'name capture and clock use switch on Memory and Time');
  var cc = J.compile(d.project);
  ok(J.analyze(d.project, cc).filter(function (f) { return f.level === 'error'; }).length === 0, 'converted project has no analyzer errors');
  require('acorn').parse(cc.code, { ecmaVersion: 5 }); ok(true);
}

/* merge de-duplicates ids */
var p0 = PRESETS[1].make(), n0 = p0.modules.lorebook.entries.length;
var merged = IO.mergeLore(p0, J.importLorebook(J.exportLorebook(p0)), 'append');
var ids = merged.modules.lorebook.entries.map(function (e) { return e.id; });
ok(ids.length === n0 * 2 && ids.filter(function (x, i) { return ids.indexOf(x) !== i; }).length === 0, 'merge keeps ids unique');
/* errors are friendly */
['', '{"foo": 1}', '{not json', '[1, 2', 'random words that mean nothing'].forEach(function (t) {
  var r = IO.detect({ text: t, name: t === '{not json' ? 'a.json' : '' });
  ok(r.kind === 'none' || r.kind === 'lorebook', 'garbage handled: ' + t + ' -> ' + r.kind);
  if (r.kind === 'none') ok(typeof r.error === 'string' && r.error.length > 5, 'error message for ' + t);
});
ok(IO.detect({ text: '{bad json' }).kind === 'none' && IO.detect({ text: '[1, 2' }).kind === 'none', 'broken JSON is reported, not imported as text');
ok(IO.detect({ bytes: new Uint8Array(TINY_PNG), name: 'plain.png' }).kind === 'none', 'plain PNG reports no card');
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
