/* Test suite: every preset must compile to strict ES5, never throw, never
   inject junk, and each module must actually do its job. */
'use strict';
var vm = require('vm');
var acorn = require('acorn');
var JSB = require('../src/generator.js');
var PRESETS = require('../src/presets.js');

var failures = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { failures++; console.log('  FAIL: ' + msg); } }

function fakeDate(iso) {
  var fixed = new Date(iso).getTime();
  function D(a, b, c, d, e, f, g) {
    if (!(this instanceof D)) return new Date(fixed).toString();
    if (arguments.length === 0) return new Date(fixed);
    return new (Function.prototype.bind.apply(Date, [null].concat([].slice.call(arguments))))();
  }
  D.now = function () { return fixed; };
  D.UTC = Date.UTC; D.parse = Date.parse; D.prototype = Date.prototype;
  return D;
}

/* Run a script against a chat state, the way Janitor would. */
function run(code, chat, opts) {
  opts = opts || {};
  var logs = [];
  var sandbox = {
    console: { log: function () { logs.push([].slice.call(arguments).join(' ')); } },
    Date: opts.date ? fakeDate(opts.date) : Date,
    Math: Math
  };
  if (opts.seedRandom !== undefined) {
    var seed = opts.seedRandom;
    var M = Object.create(Math);
    M.random = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    sandbox.Math = M;
  }
  vm.createContext(sandbox);
  var ctx = { chat: chat, character: { personality: 'P.', scenario: 'S.', name: 'Bot' } };
  sandbox.context = ctx;
  var src = opts.debug ? code.replace('var DEBUG = 0;', 'var DEBUG = 1;') : code;
  var t0 = Date.now(), err = null;
  try { new vm.Script(src).runInContext(sandbox, { timeout: 2000 }); } catch (e) { err = e; }
  return { err: err, logs: logs, ms: Date.now() - t0, p: sandbox.context.character.personality, s: sandbox.context.character.scenario, ctx: sandbox.context };
}

function added(r) { return { p: r.p.slice(2), s: r.s.slice(2) }; }

var FUZZ = [
  { last_message: 'hello there', message_count: 1 },
  { last_message: '', message_count: 0 },
  { last_message: null, message_count: 2 },
  { message_count: 2 },
  {},
  { last_message: 'word '.repeat(20000), message_count: 50 },
  { last_message: 'HELLO!!! ??? ...', message_count: 1000000 },
  { last_message: '\u00e9migr\u00e9 caf\u00e9 \u6771\u4eac \ud83d\ude00 \u2014 \u201cquotes\u201d \u2018single\u2019', message_count: 7 },
  { last_message: 'tavern sword dragon secret rumor dice listen', message_count: 'abc' },
  { last_message: 'tell me a secret about your past', message_count: 33, last_messages: ['i trust you', { message: 'thanks, you are kind' }, { text: 'odd shape' }, null, 42, { message: 'tell me a secret about your past' }] },
  { last_message: 'My name is Alex and I love horses', message_count: 4, last_messages: [{ message: 'hi' }, { message: 'My name is Alex and I love horses' }] },
  { last_message: '/(a+)+$/ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', message_count: 3 },
  { last_message: 'x', message_count: -5, last_messages: 'not an array' }
];
var HOURS = ['2026-01-05T03:30:00Z', '2026-04-10T09:00:00Z', '2026-07-17T14:00:00Z', '2026-10-30T19:00:00Z', '2026-12-25T23:59:00Z'];

PRESETS.forEach(function (preset) {
  console.log('Preset: ' + preset.title);
  [false, true].forEach(function (split) {
    var p = preset.make();
    p.settings.split = split;
    var out = JSB.compile(p);
    out.scripts.forEach(function (sc) {
      var label = preset.id + (split ? ' [split ' + sc.name + ']' : '');
      try { acorn.parse(sc.code, { ecmaVersion: 5, sourceType: 'script' }); ok(true); }
      catch (e) { ok(false, label + ' is not ES5: ' + e.message + ' near: ' + sc.code.split('\n')[e.loc.line - 1]); }
      ok(!/\u2028|\u2029/.test(sc.code), label + ' contains raw U+2028/2029');
      var BANNED = new RegExp('\\b(let|const)\\s|=>|`|\\.includes\\(|\\.startsWith\\(|\\.endsWith\\(|\\bfetch\\(|setTimeout|Promise|async |await ');
      ok(!BANNED.test(sc.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""')), label + ' contains a non-ES5 or banned construct');
      FUZZ.forEach(function (chat, ci) {
        HOURS.forEach(function (h) {
          var r = run(sc.code, JSON.parse(JSON.stringify(chat)), { date: h, debug: true });
          ok(!r.err, label + ' threw on fuzz #' + ci + ' at ' + h + ': ' + (r.err && r.err.message));
          var errs = r.logs.filter(function (l) { return / error: /.test(l); });
          ok(!errs.length, label + ' module error on fuzz #' + ci + ': ' + errs.join(' | '));
          var a = added(r);
          ok(!/undefined|NaN|\[object Object\]|null/.test(a.p + a.s), label + ' injected junk on fuzz #' + ci + ': ' + (a.p + a.s).slice(0, 200));
          ok(r.p.indexOf('P.') === 0 && r.s.indexOf('S.') === 0, label + ' overwrote the original card text');
          ok(r.ms < 1500, label + ' slow: ' + r.ms + 'ms on fuzz #' + ci);
          ok(a.p.length + a.s.length <= p.settings.maxChars + 400, label + ' blew the budget: ' + (a.p.length + a.s.length));
        });
      });
    });
  });
});

/* ---------- behaviour checks ---------- */
console.log('Behaviour');
function only(ids, mut) {
  var p = PRESETS[1].make();
  JSB.MODULE_IDS.forEach(function (id) { p.modules[id].enabled = ids.indexOf(id) !== -1; });
  if (mut) mut(p);
  return JSB.compile(p).code;
}
var code, r;

/* Lorebook: whole word, groups, unlocks, min messages, always */
code = only(['lorebook']);
r = run(code, { last_message: 'I walk across the road', message_count: 2 });
ok(r.s.indexOf('Rusty Lantern is a two') === -1, 'lore matched "across" as a key');
r = run(code, { last_message: 'Is there a TAVERN nearby?', message_count: 2 });
ok(r.s.indexOf('two-storey inn') !== -1, 'lore did not fire on TAVERN');
ok(r.p.indexOf('never lets a fight') !== -1, 'always-on lore missing');
r = run(code, { last_message: 'I heard about a dragon', message_count: 2 });
ok(r.s.indexOf('red dragon') !== -1 && r.s.indexOf('northern hills are three') !== -1, 'unlock did not pull in north_hills');
r = run(code, { last_message: 'any rumors?', message_count: 2 });
ok((r.s.indexOf('bandits') !== -1) !== (r.s.indexOf('mayor') !== -1), 'inclusion group did not pick exactly one');
r = run(code, { last_message: 'tell me your secret', message_count: 5 });
ok(r.s.indexOf('deserted') === -1, 'min messages gate ignored');
r = run(code, { last_message: 'tell me your secret', message_count: 25 });
ok(r.s.indexOf('deserted') !== -1, 'gated lore did not fire after min messages');

/* Memory */
code = only(['memory']);
r = run(code, { last_message: 'hey, my name is Alex. I love horses and I hate spiders. My dogs name is Biscuit', message_count: 3 });
ok(/name is Alex/.test(r.s), 'name not captured: ' + r.s);
ok(/likes: horses/.test(r.s), 'like not captured: ' + r.s);
ok(/dislikes: spiders/.test(r.s), 'dislike not captured');
ok(/named Biscuit/.test(r.s), 'custom fact not captured: ' + r.s);
r = run(code, { last_message: 'my name is not important', message_count: 3 });
ok(!/name is not/.test(r.s), 'lowercase non-name captured as name');

/* Emotions with negation */
code = only(['emotions']);
r = run(code, { last_message: 'I am so happy today, this is wonderful', message_count: 3 });
ok(/seems .*happy/.test(r.s), 'joy not detected: ' + r.s);
r = run(code, { last_message: 'I am not happy', message_count: 3 });
ok(!/seems .*happy/.test(r.s), 'negated joy counted');
r = run(code, { last_message: 'im scared and terrified and nervous', message_count: 3 });
ok(/strongly afraid/.test(r.s), 'strong fear not detected: ' + r.s);

/* States with escalation and fallback */
code = only(['states']);
r = run(code, { last_message: 'you are so pretty', message_count: 3 });
ok(/caught off guard/.test(r.p), 'Flustered state missing');
r = run(code, { last_message: 'you are so pretty', message_count: 9, last_messages: ['beautiful', 'gorgeous eyes', 'so cute', 'you are so pretty'] });
ok(/teases back/.test(r.p), 'escalation missing: ' + r.p);
r = run(code, { last_message: 'what is on the menu', message_count: 3 });
ok(/businesslike/.test(r.p), 'fallback state missing');

/* Meters, growth and negation flip */
code = only(['scoring']);
r = run(code, { last_message: 'hi', message_count: 2 });
ok(/wary/.test(r.p), 'Trust wary tier missing: ' + r.p);
r = run(code, { last_message: 'thank you, you are kind, i promise to help', message_count: 60 });
ok(/trusted|regular/.test(r.p), 'Trust did not rise: ' + r.p);
r = run(code, { last_message: 'you are not kind', message_count: 2 });
ok(/wary/.test(r.p), 'negated warm word should not raise trust');
code = only(['scoring'], function (p) { p.modules.scoring.meters[0].carry = true; });
r = run(code, { last_message: 'thanks', message_count: 2, last_messages: ['hello', 'Sure thing. [Trust: 20]', 'thanks'] });
ok(/trusts \{\{user\}\}/.test(r.p) && /\[Trust: 21\]/.test(r.s), 'carry-over failed: ' + r.p + ' / ' + r.s);

/* Ensemble */
code = only(['ensemble']);
r = run(code, { last_message: 'hello', message_count: 2 });
ok(/Mara: Innkeeper/.test(r.p) && r.p.indexOf('Pip:') === -1, 'only Mara should be on stage: ' + r.p);
r = run(code, { last_message: 'where is the stable boy?', message_count: 2 });
ok(/Pip: Stable boy/.test(r.p) && /Present in this scene: Mara, Pip/.test(r.s), 'alias did not bring Pip on stage: ' + r.p);
ok(/Toward Pip:/.test(r.p), 'relationship text between actors missing');

/* Time periods with offset */
code = only(['time']);
r = run(code, { last_message: 'hi', message_count: 2 }, { date: '2026-10-30T23:30:00Z' });
ok(/It is late/.test(r.s), 'night period missing at 23:30 UTC: ' + r.s);
code = only(['time'], function (p) { p.settings.utcOffset = -5; });
r = run(code, { last_message: 'hi', message_count: 2 }, { date: '2026-10-30T23:30:00Z' });
ok(/Evening/.test(r.s), 'UTC offset not applied (18:30 should be evening): ' + r.s);
r = run(code, { last_message: 'hi', message_count: 2 }, { date: '2026-10-31T01:00:00Z' });
ok(/Friday night/.test(r.s), 'weekday after offset wrong (Fri 20:00 local): ' + r.s);

/* Pacing beats with window */
code = only(['pacing']);
r = run(code, { last_message: 'hi', message_count: 16 });
ok(/courier/.test(r.s), 'beat at 16 missing');
r = run(code, { last_message: 'hi', message_count: 17 });
ok(/courier/.test(r.s), 'beat window (17) missing');
r = run(code, { last_message: 'hi', message_count: 18 });
ok(!/courier/.test(r.s), 'beat fired outside window');
r = run(code, { last_message: 'hi', message_count: 60 });
ok(/argument about the dragon/.test(r.s), 'recurring beat at 60 missing');
r = run(code, { last_message: 'hi', message_count: 2 });
ok(!/argument about the dragon/.test(r.s), 'recurring beat fired too early');

/* Random: stable mode is deterministic */
code = only(['random'], function (p) { p.settings.randomMode = 'stable'; });
var a1 = run(code, { last_message: 'lets gamble with dice', message_count: 8 }).s;
var a2 = run(code, { last_message: 'lets gamble with dice', message_count: 8 }).s;
ok(a1 === a2 && /dice|die|Snake/.test(a1), 'stable mode not deterministic or dice missing');

/* Rules */
code = only(['time', 'scoring', 'rules', 'emotions', 'ensemble'], function (p) { p.modules.rules.list[0].conds[2] = { type: 'messages', min: 0, max: 0 }; });
r = run(code, { last_message: 'tell me about your past', message_count: 30 }, { date: '2026-10-30T23:30:00Z' });
ok(/truth about her past/.test(r.s), 'rule with keyword+period did not fire: ' + r.s);
r = run(code, { last_message: 'tell me about your past', message_count: 30 }, { date: '2026-10-30T12:30:00Z' });
ok(!/truth about her past/.test(r.s), 'rule fired at noon');
r = run(code, { last_message: 'i feel so sad and lonely', message_count: 3 });
ok(/slides a mug/.test(r.s), 'emotion+actor rule did not fire: ' + r.s);

/* Budget */
code = only(['lorebook'], function (p) { p.settings.maxChars = 200; });
r = run(code, { last_message: 'tavern sword dragon north rumor', message_count: 30 });
ok(added(r).p.length + added(r).s.length <= 260, 'budget not respected: ' + (added(r).p.length + added(r).s.length));

/* Import / export round trip */
var st = { entries: { 0: { uid: 0, key: ['castle'], keysecondary: ['king'], content: 'The castle is old.', constant: false, selectiveLogic: 3, order: 50, probability: 70, useProbability: true, group: 'g', groupWeight: 30, disable: false, comment: 'Castle' } } };
var imp = JSB.importLorebook(st);
ok(imp.length === 1 && imp[0].keys === 'castle' && imp[0].logic === 'AND_ALL' && imp[0].prob === 70 && imp[0].group === 'g', 'ST import wrong: ' + JSON.stringify(imp[0]));
var card = { spec: 'chara_card_v2', data: { character_book: { entries: [{ keys: ['moon'], content: 'Moon lore', insertion_order: 5, enabled: true, constant: true }] } } };
imp = JSB.importLorebook(card);
ok(imp.length === 1 && imp[0].always && imp[0].keys === 'moon', 'V2 card import wrong');
var pr = PRESETS[1].make();
var ex = JSB.exportLorebook(pr);
ok(ex.length === pr.modules.lorebook.entries.length && Array.isArray(ex[0].key), 'export wrong');
ok(JSB.importLorebook({ entries: ex }).length === ex.length, 'export does not re-import');

/* Regex keys with commas */
ok(JSB.splitKeys('a, /b{1,3}/i, c').length === 3, 'splitKeys broke a regex with a comma');

/* Analyzer catches problems */
var bad = PRESETS[0].make();
bad.modules.lorebook.enabled = true;
bad.modules.lorebook.entries = [JSB.newLore({ id: 'x', keys: 'the', text: 'x' }), JSB.newLore({ id: 'y', keys: '', text: 'y' }), JSB.newLore({ id: 'z', keys: '/(/', text: 'z', unlocks: 'nope' })];
bad.modules.rules.enabled = true;
bad.modules.rules.list = [{ name: 'r', match: 'all', conds: [{ type: 'emotion', values: 'joy' }], text: 't' }];
var f = JSB.analyze(bad).map(function (x) { return x.level + ':' + x.message; }).join('\n');
ok(/everyday word/.test(f) && /never fire|can never fire/.test(f) && /invalid/.test(f) && /no entry has that id/.test(f) && /Emotion Engine is off/.test(f), 'analyzer missed problems:\n' + f);

/* Card blocks */
var cb = JSB.cardBlocks(PRESETS[1].make());
ok(/CHARACTER: Mara Venn \(38; Innkeeper/.test(cb.personality) && /INTERACTION_CATEGORIES/.test(cb.scenario) && /Trigger: If \{\{user\}\}/.test(cb.scenario), 'card blocks wrong');

/* ES5 checker: generated scripts are clean, modern code is caught and fixed */
var CHK = require('../src/checker.js');
PRESETS.forEach(function (p) {
  ['compact', 'readable'].forEach(function (eng) {
    var proj = p.make(); proj.settings.engine = eng;
    var out = JSB.compile(proj);
    var r = CHK.check(out.code);
    var errs = r.issues.filter(function (i) { return i.severity === 'error' || (i.severity === 'warn' && p.id !== 'blank'); });
    ok(r.es5 && !errs.length, p.id + '/' + eng + ' fails own checker: ' + JSON.stringify(errs.slice(0, 3)));
    var res = run(out.code, { last_message: 'hello there, I feel happy tonight', message_count: 30 }, { date: '2026-03-01T22:00:00Z' });
    ok(!res.error, p.id + '/' + eng + ' threw: ' + res.error);
  });
});
var modern = [
  'const a = 1; let b = 2; context.character.personality += a + b;',
  'var f = (x, y = 2) => x + y; context.character.scenario += f(1);',
  'var n = "Ann"; context.character.personality += `Hi ${n}!`;',
  'for (const w of ["a","b"]) { context.character.scenario += w; }',
  'var o = { k: 1, m() { return 2; } }; var k = 1; var p = { k };',
  'if (context.chat.last_message.includes("x") || context.chat.last_message.startsWith("y")) {}',
  'context.character.personality = "Overwritten";',
  'var xs = [...[1, 2], 3]; function g(a = 0) { return a; }',
  'var s = `multi\nline ${1 + 1}`;'
];
modern.forEach(function (m) {
  var r = CHK.check(m);
  ok(r.issues.length > 0, 'checker missed: ' + m);
  var fx = CHK.fix(m);
  var after = CHK.check(fx.code);
  ok(after.es5 && !after.issues.some(function (i) { return i.severity === 'error'; }), 'fix incomplete: ' + m + ' -> ' + fx.code);
  try { acorn.parse(fx.code, { ecmaVersion: 5 }); ok(true); } catch (e) { ok(false, 'fixed code not ES5: ' + fx.code); }
});
/* fixes keep behaviour */
var beh = CHK.fix('var f = (a = 5) => a * 2; var t = `${f()}-${f(0)}`; out = t;').code;
var bx = { out: '' }; vm.createContext(bx); vm.runInContext(beh, bx);
ok(bx.out === '10-0', 'fix changed behaviour: ' + bx.out);
ok(CHK.fix('context.character.personality = "A";').code.indexOf('+=') !== -1, 'overwrite not fixed');
ok(CHK.check('context.character.personality = context.character.personality + "x";').issues.every(function (i) { return i.rule !== 'overwrite'; }), 'self-append flagged as overwrite');
ok(CHK.check('var x = ;').syntaxError && CHK.check('var x = ;').syntaxError.line === 1, 'syntax error not located');
ok(CHK.check('var o = {a:1,}; var r = /a/y;').issues.some(function (i) { return /flag/i.test(i.message); }), 'sticky flag missed');
ok(CHK.check('while (true) { }').issues.some(function (i) { return i.rule === 'infinite-loop'; }), 'infinite loop missed');
ok(CHK.check('fetch("x"); setTimeout(function(){}, 1);').issues.filter(function (i) { return i.severity === 'error'; }).length >= 2, 'banned globals missed');

/* ---------- v2 features ---------- */
console.log('v2 features');
var DG = PRESETS.filter(function (x) { return x.id === 'dungeon'; })[0];
function dOnly(ids, mut) {
  var p = DG.make();
  JSB.MODULE_IDS.forEach(function (id) { p.modules[id].enabled = ids.indexOf(id) !== -1; });
  if (mut) mut(p);
  return JSB.compile(p).code;
}
/* Stat tracker: read back, change by keyword, clamp, no cheating */
code = dOnly(['stats']);
r = run(code, { message_count: 1, last_message: 'hello' });
ok(/HP: 30\/30 \| Gold: 15 \| Torches: 3/.test(r.s), 'stats start values wrong: ' + r.s);
ok(/End every reply with the status line/.test(r.s), 'stats format instruction missing');
r = run(code, { message_count: 8, last_messages: [{ message: 'I attack' }, { message: 'The goblin bites you.\n**HP:** 12/30 | Gold: 22 | Torches: 2' }, { message: 'I drink a potion. HP: 999' }], last_message: 'I drink a potion. HP: 999' });
ok(/HP: 22\/30/.test(r.s), 'stat not read back + changed: ' + r.s);
ok(/Gold: 22/.test(r.s) && /Torches: 2/.test(r.s), 'other stats not read back: ' + r.s);
r = run(code, { message_count: 8, last_messages: [{ message: 'HP: 3/30 | Torches: 0' }, { message: 'ok' }], last_message: 'ok' });
ok(/badly wounded/.test(r.s) && /pitch black/.test(r.s), 'low-stat text missing: ' + r.s);
r = run(code, { message_count: 8, last_messages: [{ message: 'HP: 29/30' }, { message: 'I drink a potion' }], last_message: 'I drink a potion' });
ok(/HP: 30\/30/.test(r.s), 'stat not clamped to max: ' + r.s);

/* Stats feed meter conditions in rules */
code = dOnly(['stats', 'rules']);
r = run(code, { message_count: 8, last_messages: [{ message: 'Gold: 0' }, { message: 'I visit the merchant' }], last_message: 'I visit the merchant' });
ok(/no gold left/.test(r.s), 'rule did not read stat: ' + r.s);
r = run(code, { message_count: 8, last_messages: [{ message: 'Gold: 9' }, { message: 'I visit the merchant' }], last_message: 'I visit the merchant' });
ok(!/no gold left/.test(r.s), 'rule fired with gold');

/* Dice tags and pool */
code = dOnly(['random']);
var dz = run(code, { message_count: 3, last_message: 'hi' });
ok(/Fresh dice for this reply/.test(dz.s) && /1d20: \d+, \d+, \d+, \d+ \| 2d6: \d+, \d+, \d+/.test(dz.s), 'dice pool wrong: ' + dz.s);
var tagCode = code;
var ctxRun = (function () {
  var sb = { console: { log: function () {} }, Math: Math, Date: Date };
  vm.createContext(sb);
  sb.context = { chat: { message_count: 3, last_message: 'hi' }, character: { personality: 'Str <<1d20+2>> and <<2d6>>, not <<hello>>', scenario: '' } };
  new vm.Script(tagCode).runInContext(sb);
  return sb.context.character.personality;
})();
ok(/^Str \d+ and \d+, not <<hello>>/.test(ctxRun), 'dice tags not replaced: ' + ctxRun);
var nums = /^Str (\d+) and (\d+)/.exec(ctxRun);
ok(nums && +nums[1] >= 3 && +nums[1] <= 22 && +nums[2] >= 2 && +nums[2] <= 12, 'dice tag out of range: ' + ctxRun);

/* Lore word forms */
code = dOnly(['lorebook']);
r = run(code, { message_count: 3, last_message: 'Three goblins block the path' });
ok(/travel in threes/.test(r.s), 'word forms: goblins did not match goblin');
r = run(code, { message_count: 3, last_message: 'the doorway is dark' });
ok(!/iron door on level two/.test(r.s), 'word forms matched inside doorway');
code = dOnly(['lorebook'], function (p) { p.modules.lorebook.forms = false; });
r = run(code, { message_count: 3, last_message: 'Three goblins block the path' });
ok(!/travel in threes/.test(r.s), 'word forms on when switched off');
code = only(['lorebook'], function (p) { p.modules.lorebook.forms = true; p.modules.lorebook.entries.push(JSB.newLore({ id: 'cty', keys: 'city', text: 'CITYLORE' }), JSB.newLore({ id: 'dnc', keys: 'dance', text: 'DANCELORE' })); });
r = run(code, { message_count: 3, last_message: 'the cities are dancing' });
ok(/CITYLORE/.test(r.s) && /DANCELORE/.test(r.s), 'word forms y/e endings: ' + r.s.slice(-80));

/* Foreshadowing and payoff */
code = dOnly(['pacing'], function (p) { p.modules.pacing.foreshadow[0].chance = 100; });
r = run(code, { message_count: 10, last_message: 'onward' });
ok(/Foreshadowing .*low rumble/.test(r.s), 'hint missing: ' + r.s);
r = run(code, { message_count: 3, last_message: 'onward' });
ok(!/low rumble/.test(r.s), 'hint before its start');
r = run(code, { message_count: 41, last_message: 'onward' });
ok(/It is awake now/.test(r.s) && !/low rumble/.test(r.s), 'payoff wrong: ' + r.s);
r = run(code, { message_count: 50, last_message: 'onward' });
ok(!/It is awake now/.test(r.s), 'payoff repeated');

/* Recap nudge */
code = dOnly(['memory']);
r = run(code, { message_count: 40, last_message: 'hi' });
ok(/short recap/.test(r.s), 'recap missing at 40');
r = run(code, { message_count: 33, last_message: 'hi' });
ok(!/short recap/.test(r.s), 'recap at 33');

/* Writing style */
code = dOnly(['style']);
r = run(code, { message_count: 6, last_messages: [{ message: 'Her voice was barely above a whisper. A shiver ran down his spine.' }, { message: 'go on' }], last_message: 'go on' });
ok(/Avoid these overused phrases/.test(r.p), 'style avoid list missing');
ok(/last reply used "a shiver ran down", "barely above a whisper"/.test(r.p) || /last reply used "barely above a whisper", "a shiver ran down"/.test(r.p), 'style echo missing: ' + r.p);
r = run(code, { message_count: 6, last_message: 'A shiver ran down my spine' });
ok(!/last reply used/.test(r.p), 'style echo read the user message');
var r1 = run(code, { message_count: 2, last_message: 'a' }), r2 = run(code, { message_count: 4, last_message: 'a' });
ok(r1.p !== r2.p, 'style list does not rotate');

/* Every starter project is clean in the Analyzer */
PRESETS.forEach(function (pr) { var pp = pr.make(); var fs = JSB.analyze(pp, JSB.compile(pp)).filter(function (f) { return f.level === 'error'; }); ok(!fs.length, pr.id + ' has analyzer errors: ' + fs.map(function (f) { return f.message; }).join(' | ')); });

/* Markdown notes import */
var IOm = require('../src/io.js');
var mdr = IOm.detect({ text: '---\nkeys: [sword, blade]\npriority: 5\n---\n# Moonblade\nAn old [[Elven]] sword.\n---\naliases:\n  - Old Mara\n---\n# Mara\nThe hedge witch.\n' });
ok(mdr.kind === 'lorebook' && mdr.entries.length === 2, 'markdown notes not detected');
ok(mdr.entries[0].keys === 'sword, blade' && mdr.entries[0].text === 'An old Elven sword.' && mdr.entries[0].prio === 5, 'markdown note 1 wrong: ' + JSON.stringify(mdr.entries[0]));
ok(/mara/.test(mdr.entries[1].keys) && /Old Mara/.test(mdr.entries[1].keys), 'markdown aliases wrong: ' + mdr.entries[1].keys);

/* Checker lints */
var lint = CHK.check('var m = context.chat.last_message || ""; if (m.indexOf("secret") !== -1) { context.character.scenario += "x"; } try { m = 1; } catch (e) {} if (m == 1) {}');
['substring-match', 'silent-catch', 'loose-equality'].forEach(function (rule) { ok(lint.issues.some(function (i) { return i.rule === rule; }), 'checker missed ' + rule); });
ok(!CHK.check('context.character.scenario = context.character.scenario.replace(/a/g, "b");').issues.some(function (i) { return i.rule === 'overwrite'; }), 'in-place replace flagged as overwrite');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
