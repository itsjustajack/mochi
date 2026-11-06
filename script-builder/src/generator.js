/* ==========================================================================
   JanitorAI Script Builder: generator
   Turns a project (plain JSON) into an ES5 Janitor Advanced script.
   Runs in the browser and in Node (for the test suite).  No network.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var fs = require('fs'), path = require('path');
    module.exports = factory(fs.readFileSync(path.join(__dirname, 'runtime.es5.js'), 'utf8'));
  } else {
    root.JSB = factory(root.JSB_RUNTIME_SOURCE);
  }
})(typeof self !== 'undefined' ? self : this, function (RUNTIME_SOURCE) {
  'use strict';

  var VERSION = '2.0.0';

  /* ---------- runtime sections ---------- */
  var RUNTIME = {};
  (function () {
    var parts = String(RUNTIME_SOURCE || '').split(/^\/\/@@ (\w+)\s*$/m);
    for (var i = 1; i < parts.length; i += 2) RUNTIME[parts[i]] = parts[i + 1].replace(/^\n+|\s+$/g, '') + '\n';
  })();

  /* Order matters: later modules read what earlier ones worked out. */
  var MODULES = [
    { id: 'time', name: 'Time & Environment', icon: '\ud83c\udf05', blurb: 'Real clock (with time zone), periods of the day, weekdays and seasons.' },
    { id: 'memory', name: 'Memory', icon: '\ud83e\udde0', blurb: 'Picks up the user\'s name, likes, dislikes, fears and custom facts from recent messages.' },
    { id: 'emotions', name: 'Emotion Engine', icon: '\ud83d\udc97', blurb: 'Reads the user\'s mood (8 basic emotions) with negation handling and decay.' },
    { id: 'states', name: 'States & Triggers', icon: '\ud83c\udfad', blurb: 'Interaction states (Neutral, Flustered, Conflict, Repair...) with escalation.' },
    { id: 'scoring', name: 'Meters', icon: '\ud83c\udfaf', blurb: 'Affection, Trust, Sanity... warm/cold words move a value, tiers change behaviour.' },
    { id: 'stats', name: 'Stat Tracker', icon: '\ud83d\udccb', blurb: 'HP, gold, day counter... the bot writes a status line and the script reads it back, so numbers last between replies.' },
    { id: 'ensemble', name: 'Ensemble Cast', icon: '\ud83d\udc65', blurb: 'Multi-character scenes: personality sliders, speech, quirks, relationships, focus budget.' },
    { id: 'lorebook', name: 'Lorebook', icon: '\ud83d\udcd6', blurb: 'Keyword lore with every Janitor Lorebook setting, groups, unlocks and import.' },
    { id: 'pacing', name: 'Pacing', icon: '\ud83d\udcca', blurb: 'Story phases by message count, one-time beats and recurring beats.' },
    { id: 'random', name: 'Random Events', icon: '\ud83c\udfb2', blurb: 'Keyword dice with weighted outcomes, plus random encounters.' },
    { id: 'ambient', name: 'Ambient', icon: '\ud83c\udf3f', blurb: 'Small chance of atmosphere each reply, filtered by time of day.' },
    { id: 'style', name: 'Writing Style', icon: '\u270d\ufe0f', blurb: 'Anti-slop: keeps the bot off worn-out phrases and calls out the ones it just used.' },
    { id: 'rules', name: 'Combined Rules', icon: '\ud83d\udd17', blurb: 'IF keyword AND time AND mood AND meter... THEN text.' }
  ];
  var MODULE_IDS = MODULES.map(function (m) { return m.id; });

  var EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'trust', 'disgust', 'anticipation', 'surprise'];
  var EMOTION_LABELS = { joy: 'happy', sadness: 'sad', anger: 'angry', fear: 'afraid', trust: 'trusting', disgust: 'disgusted', anticipation: 'eager', surprise: 'surprised' };
  var LEXICON = {
    joy: ['happy', 'glad', 'joy', 'joyful', 'delighted', 'excited', 'wonderful', 'amazing', 'awesome', 'yay', 'fun', 'laugh', 'laughing', 'smile', 'smiling', 'cheerful', 'thrilled', 'celebrate', 'haha', 'lol', 'great day'],
    sadness: ['sad', 'unhappy', 'cry', 'crying', 'cried', 'tears', 'lonely', 'depressed', 'heartbroken', 'grief', 'hopeless', 'upset', 'miserable', 'gloomy', 'hurts', 'sobbing', 'devastated'],
    anger: ['angry', 'mad', 'furious', 'hate', 'annoyed', 'irritated', 'pissed', 'rage', 'livid', 'frustrated', 'fed up', 'sick of', 'shut up', 'outraged', 'resent'],
    fear: ['scared', 'afraid', 'terrified', 'nervous', 'anxious', 'worried', 'panic', 'panicking', 'frightened', 'creepy', 'shaking', 'uneasy', 'dread', 'trembling'],
    trust: ['trust', 'believe you', 'safe', 'rely on', 'honest', 'promise', 'loyal', 'depend on', 'comfortable', 'count on', 'faith in'],
    disgust: ['gross', 'disgusting', 'ew', 'eww', 'nasty', 'vile', 'revolting', 'yuck', 'repulsive', 'sickening'],
    anticipation: ['cant wait', 'looking forward', 'excited for', 'soon', 'tomorrow', 'ready', 'eager', 'hoping', 'planning'],
    surprise: ['wow', 'whoa', 'surprised', 'shocked', 'unexpected', 'suddenly', 'omg', 'no way', 'seriously', 'unbelievable']
  };

  var OCEAN_WORDS = {
    O: ['curious and imaginative', 'practical, prefers the familiar'],
    C: ['organized and dependable', 'spontaneous, a little careless'],
    E: ['outgoing and talkative', 'reserved and quiet'],
    A: ['warm and cooperative', 'blunt and skeptical'],
    N: ['anxious and easily stressed', 'calm and steady under pressure']
  };
  var TEMPERAMENTS = { '': '', Choleric: 'quick to act and to anger', Melancholic: 'thoughtful and prone to brooding', Phlegmatic: 'easygoing and slow to react', Sanguine: 'lively and sociable' };
  var SPEECH = {
    tone: ['Neutral', 'Warm', 'Cold', 'Playful', 'Sarcastic', 'Formal', 'Gruff', 'Gentle', 'Flirty', 'Nervous', 'Dry', 'Theatrical'],
    pacing: ['Medium', 'Slow', 'Fast', 'Halting'],
    verbosity: ['Balanced', 'Terse', 'Chatty'],
    diction: ['Plain', 'Casual', 'Formal', 'Archaic', 'Slang', 'Technical', 'Poetic', 'Street']
  };

  /* Quirk library (from MythOS Studio's speech.quirks.json). */
  var QUIRKS = {
    physical: ['Taps fingers', 'Adjusts glasses', 'Clears throat softly', 'Chews lip', 'Rubs neck', 'Rolls shoulders', 'Cracks knuckles quietly', 'Checks watch', 'Fidgets with ring', 'Touches ear', 'Rakes hair back', 'Shifts weight from foot to foot', 'Tugs sleeve', 'Tilts head to listen', 'Brows knit', 'Pinches bridge of nose', 'Rubs temples', 'Sighs through nose', 'Gestures with open palm', 'Shrugs one shoulder', 'Pockets hands', 'Taps foot in place', 'Stands too close', 'Sits forward on chair edge', 'Crosses arms then uncrosses', 'Wets lips before speaking', 'Cradles mug with both hands'],
    mental: ['Overexplains simple points', 'Loses track mid-sentence', 'Asks for the exact wording', 'Rehearses answer silently first', 'Counts options on fingers', 'Quotes prior conversations', 'Corrects word choice after speaking', 'Starts sentences with caveats', 'Restates question before answering', 'Skips steps when excited', 'Returns to unfinished tangents', 'Uses analogies frequently', 'Hedges with maybe/probably', 'Double-checks assumptions aloud', 'Revises conclusion midstream', 'Flags unknowns explicitly', 'Defaults to worst-case planning', 'Summarizes what they heard', 'Speaks in bullet points', 'Translates jargon on the fly'],
    emotional: ['Laughs quietly when nervous', 'Smiles to smooth tension', 'Avoids eye contact under stress', 'Holds breath when upset', 'Voice tightens with frustration', 'Speaks faster when excited', 'Long pauses before bad news', 'Deflects compliments', 'Downplays personal wins', 'Brags to cover insecurity', 'Gets defensive when corrected', 'Goes silent when angry', 'Uses humor to defuse conflict', 'Seeks reassurance frequently', 'Apologizes preemptively', 'Switches topics away from feelings', 'Names their emotion directly', 'Goes formal when uncomfortable', 'Voice cracks when moved', 'Hums a bar of a song unconsciously', 'Ends sentences as questions when unsure']
  };
  var CUE_DEFAULTS = { joy: 'Smiles softly, eyes bright.', sadness: 'Voice trembles, words slow down.', anger: 'Speaks sharply, shoulders tense.', fear: 'Glances around, tone unsteady.', trust: 'Leans in slightly, relaxed tone.', disgust: 'Wrinkles nose, slight recoil.', anticipation: 'Quickens speech, leans forward.', surprise: 'Brows lift, pauses mid-sentence.' };

  /* Relationship presets (from MythOS Studio's relationships panel). */
  var REL_PRESETS = {
    ally: { trust: 0.7, affinity: 0.7, respect: 0.6, rivalry: 0.1, influence: 0.4, tip: 'Warm alignment. Mutual support is expected.' },
    mentor: { trust: 0.7, affinity: 0.5, respect: 0.9, rivalry: 0.1, influence: 0.7, tip: 'Guidance role. High respect; influence from experience.' },
    rival: { trust: 0.3, affinity: 0.3, respect: 0.7, rivalry: 0.85, influence: 0.4, tip: 'Competitive tension. Respect may be high; trust often low.' },
    family: { trust: 0.8, affinity: 0.8, respect: 0.6, rivalry: 0.15, influence: 0.6, tip: 'Deep bond. High trust/affinity; rivalry minimal unless strained.' },
    enemy: { trust: 0.05, affinity: 0.05, respect: 0.3, rivalry: 0.9, influence: 0.3, tip: 'Active opposition. Hostility dominates; trust is rare.' },
    lover: { trust: 0.6, affinity: 0.95, respect: 0.6, rivalry: 0.1, influence: 0.7, tip: 'Romantic or infatuated. High affinity; trust varies.' },
    stranger: { trust: 0.4, affinity: 0.4, respect: 0.4, rivalry: 0.1, influence: 0.1, tip: 'Limited history. Neutral baseline until proven otherwise.' },
    custom: { trust: 0.5, affinity: 0.5, respect: 0.5, rivalry: 0.2, influence: 0.3, tip: 'Define your own stance and tune the sliders.' }
  };

  /* Worn-out phrases that make AI roleplay read the same everywhere.
     Users can edit the list; a few rotate in each reply. */
  var SLOP = ['a shiver ran down', 'barely above a whisper', 'eyes sparkling with mischief', 'testament to', 'tapestry', 'ministrations', 'smelled of ozone',
    'little did they know', 'the air was thick with', 'electricity in the air', 'smirk playing on', 'maybe, just maybe', 'something shifted',
    'a dance of', 'palpable tension', 'breath hitched', 'let out a breath they did not know they were holding', 'eyes darkened',
    'a wave of', 'it was not just', 'in that moment', 'the weight of', 'send shivers', 'stark contrast', 'pang of', 'unspoken promise',
    'searing', 'orbs', 'padded over', 'an air of', 'like a predator', 'the ghost of a smile', 'voice dripping with', 'with a newfound',
    'ruin you', 'you are playing a dangerous game', 'what are you doing to me'];
  var STYLE_RULES = 'Write with fresh, concrete details. Vary how sentences start. Show feelings through actions and dialogue instead of naming them. Do not speak or act for {{user}}. Do not end replies with a question every time or with a summary of the mood.';

  var WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  var SEASONS = ['spring', 'summer', 'autumn', 'winter'];

  /* ---------- small helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v, fb) { var n = parseFloat(v); return isNaN(n) ? fb : n; }
  function int(v, fb) { var n = parseInt(v, 10); return isNaN(n) ? fb : n; }
  function s(v) { return v === undefined || v === null ? '' : String(v); }
  function trim(v) { return s(v).replace(/^\s+|\s+$/g, ''); }
  function slug(v) { return trim(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item'; }
  var uidN = 0;
  function uid(prefix) { uidN++; return (prefix || 'id') + '_' + Date.now().toString(36).slice(-4) + uidN.toString(36); }

  /* Split a comma list, keeping commas inside /regex/ keys intact. */
  function splitKeys(text) {
    var src = s(text), out = [], cur = '', inRx = false, i, ch;
    if (Array.isArray(text)) return text.map(trim).filter(Boolean);
    for (i = 0; i < src.length; i++) {
      ch = src.charAt(i);
      if (ch === '/' && trim(cur) === '' && !inRx) { inRx = true; cur += ch; continue; }
      if (inRx && ch === '/' && src.charAt(i - 1) !== '\\') { inRx = false; cur += ch; continue; }
      if (!inRx && (ch === ',' || ch === '\n')) { if (trim(cur)) out.push(trim(cur)); cur = ''; continue; }
      cur += ch;
    }
    if (trim(cur)) out.push(trim(cur));
    return out;
  }
  function splitLines(text) { return s(text).split(/\n/).map(trim).filter(Boolean); }
  /* "kind, sweet:2, thank you" -> [{word:'kind',weight:1},...] */
  function weighted(text) {
    return splitKeys(text).map(function (k) {
      var m = /^(.*?):\s*(-?\d+(?:\.\d+)?)$/.exec(k);
      return m ? { word: trim(m[1]), weight: parseFloat(m[2]) } : { word: k, weight: 1 };
    }).filter(function (w) { return w.word; });
  }

  /* ---------- ES5 literal writer ---------- */
  var RESERVED = /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield|let|static|implements|interface|package|private|protected|public)$/;
  function strLit(v) { return JSON.stringify(s(v)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
  function keyLit(k) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED.test(k) ? k : strLit(k); }
  function lit(v, ind) {
    ind = ind || '';
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '0';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return strLit(v);
    var inner = ind + '  ', parts, flat;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      parts = v.map(function (x) { return lit(x, inner); });
      flat = '[' + parts.join(', ') + ']';
      if (flat.length <= 90 && flat.indexOf('\n') === -1) return flat;
      /* Lists of plain values wrap like prose instead of one per line. */
      if (v.every(function (x) { return x === null || typeof x !== 'object'; })) {
        var rows = [], row = '';
        parts.forEach(function (x) {
          if (row && (inner.length + row.length + x.length + 2) > 92) { rows.push(row + ','); row = x; }
          else row = row ? row + ', ' + x : x;
        });
        rows.push(row);
        return '[\n' + inner + rows.join('\n' + inner) + '\n' + ind + ']';
      }
      return '[\n' + inner + parts.join(',\n' + inner) + '\n' + ind + ']';
    }
    var keys = Object.keys(v);
    if (!keys.length) return '{}';
    parts = keys.map(function (k) { return keyLit(k) + ': ' + lit(v[k], inner); });
    flat = '{ ' + parts.join(', ') + ' }';
    if (flat.length <= 110 && flat.indexOf('\n') === -1) return flat;
    return '{\n' + inner + parts.join(',\n' + inner) + '\n' + ind + '}';
  }

  /* ---------- default project ---------- */
  function defaultModules() {
    return {
      time: {
        enabled: false, prio: 40, target: 'scenario', clock: false, southern: false,
        periods: [
          { name: 'dawn', from: 5, to: 8, text: 'Early morning light creeps in; the world is still waking up.' },
          { name: 'morning', from: 8, to: 12, text: 'It is morning. {{char}} is alert and busy with the day.' },
          { name: 'afternoon', from: 12, to: 17, text: 'It is the afternoon, bright and unhurried.' },
          { name: 'evening', from: 17, to: 21, text: 'Evening has settled in. {{char}} is winding down and more relaxed.' },
          { name: 'night', from: 21, to: 5, text: 'It is late at night. Everything is quiet and {{char}} is a little sleepy.' }
        ],
        days: {}, seasons: {}
      },
      memory: {
        enabled: false, prio: 70, target: 'scenario', depth: 10, maxItems: 4,
        captureName: true, namePhrases: 'my name is, call me, i go by, im called, name\'s', nameTemplate: '{{user}}\'s name is $1. {{char}} remembers it and uses it naturally.',
        capturePrefs: true,
        likePhrases: 'i love, i like, i really like, i adore, i enjoy, my favorite is, im a fan of',
        dislikePhrases: 'i hate, i dislike, i cant stand, i despise, i dont like',
        fearPhrases: 'im afraid of, im scared of, i fear, im terrified of',
        facts: [],
        recapEvery: 0, recapText: 'Before your reply, add a short recap in brackets (3 to 5 lines) of the most important events, names and promises so far, so they are not forgotten.'
      },
      emotions: {
        enabled: false, prio: 60, target: 'personality', depth: 3, threshold: 1, strongAt: 3, announce: true,
        extra: { joy: '', sadness: '', anger: '', fear: '', trust: '', disgust: '', anticipation: '', surprise: '' },
        reactions: { joy: '{{char}} picks up on the good mood and matches it.', sadness: '{{char}} softens, slows down and offers comfort.', anger: '{{char}} stays steady and does not escalate.', fear: '{{char}} becomes protective and reassuring.', trust: '{{char}} opens up a little more.', disgust: '{{char}} acknowledges the reaction and changes course.', anticipation: '{{char}} shares the excitement about what comes next.', surprise: '{{char}} reacts to the surprise before moving on.' }
      },
      states: {
        enabled: false, prio: 55, target: 'personality', depth: 4, fallbackName: 'neutral', fallback: '',
        list: []
      },
      scoring: { enabled: false, meters: [] },
      stats: { enabled: false, prio: 68, target: 'scenario', depth: 6, instruct: true, label: 'Current stats:', list: [] },
      ensemble: {
        enabled: false, prio: 65, depth: 3, maxActive: 3, budget: 1200,
        direction: 'Give each present character a distinct voice; not everyone needs to speak every turn.',
        cast: []
      },
      lorebook: { enabled: false, prio: 50, depth: 3, limit: 4, groupMode: 'weight', forms: false, entries: [] },
      pacing: { enabled: false, prio: 45, window: 1, phases: [], beats: [], recurring: [], foreshadow: [] },
      random: { enabled: false, prio: 30, depth: 1, triggers: [], encounterChance: 0, encounterMin: 0, encounters: '', diceTags: false, pool: '' },
      ambient: { enabled: false, prio: 20, chance: 8, minMsg: 0, list: [] },
      style: { enabled: false, prio: 35, target: 'personality', rules: STYLE_RULES, phrases: SLOP.join(', '), perTurn: 6, echo: true, depth: 2 },
      rules: { enabled: false, list: [] }
    };
  }

  function defaultCard() {
    return {
      name: '', age: '', role: '', appearance: '', psych: '', social: '', sensory: '',
      format: 'Italics = actions. Quotes = dialogue. Brackets = thoughts. Parentheses = out of character.',
      location: '', timeContext: '', userRelation: 'Stranger', trustLevel: 'Low', conflictLevel: 'Neutral',
      neutral: '', comfort: '', affection: '', conflict: '', teasing: '',
      triggers: '', escalation: '', deescalation: '', repair: '',
      replyLength: 'Medium (2-4 paragraphs)', tone: '', sceneNotes: '', useStates: true
    };
  }

  function defaultProject() {
    return {
      jsb: VERSION,
      meta: { title: 'My Janitor Script', character: '', notes: '' },
      settings: { debug: false, engine: 'compact', maxChars: 2500, utcOffset: 0, randomMode: 'random', leadPersonality: '\n\n', leadScenario: '\n\n', join: '\n', tag: 'JSB', split: false, embed: false },
      modules: defaultModules(),
      card: defaultCard()
    };
  }

  /* Fill in anything missing (older saves, hand-edited JSON). */
  function normalize(p) {
    var base = defaultProject(), out = p && typeof p === 'object' ? clone(p) : {};
    out.jsb = VERSION;
    out.meta = Object.assign({}, base.meta, out.meta || {});
    out.settings = Object.assign({}, base.settings, out.settings || {});
    out.card = Object.assign({}, base.card, out.card || {});
    out.modules = out.modules || {};
    MODULE_IDS.forEach(function (id) {
      out.modules[id] = Object.assign({}, base.modules[id], out.modules[id] || {});
    });
    var em = out.modules.emotions;
    em.extra = Object.assign({}, base.modules.emotions.extra, em.extra || {});
    em.reactions = Object.assign({}, base.modules.emotions.reactions, em.reactions || {});
    (out.modules.ensemble.cast || []).forEach(function (a) { normalizeActor(a); });
    (out.modules.lorebook.entries || []).forEach(function (e) { normalizeLore(e); });
    return out;
  }

  function newLore(o) { return normalizeLore(Object.assign({}, o || {})); }
  function normalizeLore(e) {
    var d = { id: uid('lore'), name: '', category: 'place', keys: '', secondary: '', logic: 'AND_ANY', cs: false, ww: true, target: 'scenario', prio: 10, minMsg: 0, maxMsg: 0, prob: 100, group: '', weight: 100, always: false, depth: 0, text: '', unlocks: '', enabled: true, comment: '' };
    for (var k in d) if (e[k] === undefined) e[k] = d[k];
    return e;
  }
  function newActor(o) { return normalizeActor(Object.assign({}, o || {})); }
  function normalizeActor(a) {
    var d = { id: uid('actor'), name: 'New character', aliases: '', presence: 'mentioned', snapshot: '', ocean: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 }, temperament: '', traitsExtra: '', speech: { tone: 'Neutral', pacing: 'Medium', verbosity: 'Balanced', diction: 'Plain', notes: '' }, quirks: [], cues: clone(CUE_DEFAULTS), focus: 30, relations: [], enabled: true, cs: false };
    for (var k in d) if (a[k] === undefined) a[k] = d[k];
    a.ocean = Object.assign({}, d.ocean, a.ocean);
    a.speech = Object.assign({}, d.speech, a.speech);
    a.cues = Object.assign({}, clone(CUE_DEFAULTS), a.cues);
    return a;
  }
  function newRelation(to, type) {
    var p = REL_PRESETS[type || 'ally'];
    return { to: to || 'user', type: type || 'ally', trust: p.trust, affinity: p.affinity, respect: p.respect, rivalry: p.rivalry, influence: p.influence, note: '' };
  }

  /* ---------- compile-time text builders ---------- */
  function oceanText(a) {
    var out = [], k, v;
    ['O', 'C', 'E', 'A', 'N'].forEach(function (k) {
      v = num(a.ocean && a.ocean[k], 0.5);
      if (v >= 0.7) out.push(OCEAN_WORDS[k][0]);
      else if (v <= 0.3) out.push(OCEAN_WORDS[k][1]);
    });
    if (a.temperament && TEMPERAMENTS[a.temperament]) out.push(TEMPERAMENTS[a.temperament]);
    if (trim(a.traitsExtra)) out.push(trim(a.traitsExtra));
    if (!out.length) return '';
    var t = out.join('; ');
    return t.charAt(0).toUpperCase() + t.slice(1) + '.';
  }
  function speechText(sp) {
    if (!sp) return '';
    var bits = [];
    if (sp.tone && sp.tone !== 'Neutral') bits.push(sp.tone.toLowerCase());
    if (sp.pacing && sp.pacing !== 'Medium') bits.push(sp.pacing.toLowerCase() + ' pace');
    if (sp.verbosity && sp.verbosity !== 'Balanced') bits.push(sp.verbosity.toLowerCase());
    if (sp.diction && sp.diction !== 'Plain') bits.push(sp.diction.toLowerCase() + ' wording');
    if (trim(sp.notes)) bits.push(trim(sp.notes));
    return bits.join(', ');
  }
  function relationText(r) {
    var bits = [], t = num(r.trust, 0.5), a = num(r.affinity, 0.5), re = num(r.respect, 0.5), ri = num(r.rivalry, 0), inf = num(r.influence, 0);
    if (t >= 0.7) bits.push('trusts them'); else if (t <= 0.25) bits.push('does not trust them');
    if (a >= 0.85) bits.push('deeply fond of them'); else if (a >= 0.65) bits.push('fond of them'); else if (a <= 0.25) bits.push('cold toward them');
    if (re >= 0.75) bits.push('respects them'); else if (re <= 0.2) bits.push('looks down on them');
    if (ri >= 0.7) bits.push('openly competitive'); else if (ri >= 0.45) bits.push('a little competitive');
    if (inf >= 0.65) bits.push('easily swayed by them');
    var label = r.type && r.type !== 'custom' ? r.type : '';
    var txt = (label ? label + ', ' : '') + (bits.length ? bits.join(', ') : 'neutral');
    if (trim(r.note)) txt += '. ' + trim(r.note);
    return txt.charAt(0).toUpperCase() + txt.slice(1) + (/[.!?]$/.test(txt) ? '' : '.');
  }

  /* ---------- module data builders (project -> runtime data) ---------- */
  function keyOpts(o) { var r = {}; if (o.cs) r.cs = true; if (o.ww === false) r.ww = false; return r; }

  /* "3d6 x5, 1d20 x3" -> [{dice:'3d6', count:5}, ...] */
  function dicePool(text) {
    return splitKeys(text).map(function (d) {
      var mm = /^(\d{0,2}d\d{1,4}(?:[+-]\d{1,4})?)(?:[x*](\d+))?$/i.exec(d.replace(/\s+/g, ''));
      return mm ? { dice: mm[1].toLowerCase(), count: Math.max(1, Math.min(20, int(mm[2], 5))) } : null;
    }).filter(Boolean);
  }

  var BUILD = {
    time: function (m) {
      var days = {}, seasons = {}, any = false, anyS = false;
      WEEKDAYS.forEach(function (d) { if (trim(m.days && m.days[d])) { days[d] = trim(m.days[d]); any = true; } });
      SEASONS.forEach(function (d) { if (trim(m.seasons && m.seasons[d])) { seasons[d] = trim(m.seasons[d]); anyS = true; } });
      return { TIME: { target: m.target, prio: num(m.prio, 40), clock: !!m.clock, southern: !!m.southern, periods: (m.periods || []).filter(function (p) { return trim(p.name); }).map(function (p) { var o = { name: slug(p.name), from: int(p.from, 0), to: int(p.to, 0), text: trim(p.text) }; if (p.target && p.target !== m.target) o.target = p.target; return o; }), days: any ? days : null, seasons: anyS ? seasons : null } };
    },
    memory: function (m) {
      return { MEMORY: {
        target: m.target, prio: num(m.prio, 70), depth: int(m.depth, 10), maxItems: int(m.maxItems, 4),
        captureName: !!m.captureName, namePhrases: splitKeys(m.namePhrases), nameTemplate: trim(m.nameTemplate) || '{{user}}\'s name is $1.',
        capturePrefs: !!m.capturePrefs, likePhrases: splitKeys(m.likePhrases), dislikePhrases: splitKeys(m.dislikePhrases), fearPhrases: splitKeys(m.fearPhrases),
        facts: (m.facts || []).filter(function (f) { return trim(f.phrases) && trim(f.template); }).map(function (f) { return { label: slug(f.label), phrases: splitKeys(f.phrases), words: int(f.words, 3), template: trim(f.template) }; }),
        recapEvery: int(m.recapEvery, 0) >= 2 ? int(m.recapEvery, 0) : 0, recapText: trim(m.recapText)
      } };
    },
    emotions: function (m) {
      var lex = {}, reactions = {};
      EMOTIONS.forEach(function (e) {
        var words = LEXICON[e].slice();
        splitKeys(m.extra && m.extra[e]).forEach(function (w) { if (words.indexOf(w.toLowerCase()) === -1) words.push(w.toLowerCase()); });
        lex[e] = words;
        reactions[e] = trim(m.reactions && m.reactions[e]);
      });
      return { EMOTIONS: { target: m.target, prio: num(m.prio, 60), depth: int(m.depth, 3), threshold: num(m.threshold, 1), strongAt: num(m.strongAt, 3), announce: !!m.announce, labels: EMOTION_LABELS, lexicon: lex, reactions: reactions } };
    },
    states: function (m) {
      return { STATES: {
        target: m.target, prio: num(m.prio, 55), depth: int(m.depth, 4), fallbackName: slug(m.fallbackName || 'neutral'), fallback: trim(m.fallback),
        list: (m.list || []).filter(function (x) { return x.enabled !== false && trim(x.name) && trim(x.text) && splitKeys(x.keys).length; }).map(function (x) {
          var o = Object.assign({ name: slug(x.name), keys: splitKeys(x.keys), text: trim(x.text), prio: num(x.prio, 0) }, keyOpts(x));
          if (trim(x.escalated)) { o.escalated = trim(x.escalated); o.escalateAt = int(x.escalateAt, 3); }
          if (int(x.minMsg, 0)) o.minMsg = int(x.minMsg, 0);
          if (int(x.maxMsg, 0)) o.maxMsg = int(x.maxMsg, 0);
          return o;
        })
      } };
    },
    scoring: function (m) {
      return { METERS: (m.meters || []).filter(function (x) { return x.enabled !== false && trim(x.name); }).map(function (x) {
        return {
          name: trim(x.name), start: num(x.start, 0), min: num(x.min, -100), max: num(x.max, 100), growth: num(x.growth, 0), depth: int(x.depth, 5),
          up: weighted(x.up), down: weighted(x.down), target: x.target || 'personality', prio: num(x.prio, 58), carry: !!x.carry, show: !!x.show,
          tiers: (x.tiers || []).filter(function (t) { return trim(t.text); }).map(function (t) { return { name: trim(t.name), from: num(t.from, -9999), to: num(t.to, 9999), text: trim(t.text) }; })
        };
      }) };
    },
    stats: function (m) {
      return { STATS: {
        target: m.target === 'personality' ? 'personality' : 'scenario', prio: num(m.prio, 68), depth: int(m.depth, 6), instruct: !!m.instruct, label: trim(m.label) || 'Current stats:',
        list: (m.list || []).filter(function (x) { return x.enabled !== false && trim(x.name); }).map(function (x) {
          var o = { name: trim(x.name).replace(/[:=|]/g, ''), start: num(x.start, 0), changes: weighted(x.changes) };
          if (trim(x.min) !== '') o.min = num(x.min, 0);
          if (trim(x.max) !== '') o.max = num(x.max, 100);
          if (x.showMax) o.showMax = true;
          if (trim(x.lowText)) { o.low = num(x.low, 0); o.lowText = trim(x.lowText); }
          if (trim(x.highText)) { o.high = num(x.high, 100); o.highText = trim(x.highText); }
          return o;
        })
      } };
    },
    style: function (m) {
      return { STYLE: { target: m.target === 'scenario' ? 'scenario' : 'personality', prio: num(m.prio, 35), rules: trim(m.rules), phrases: splitKeys(m.phrases).map(function (x) { return x.toLowerCase(); }), perTurn: int(m.perTurn, 6), echo: !!m.echo, depth: int(m.depth, 2) } };
    },
    ensemble: function (m) {
      var cast = (m.cast || []).filter(function (a) { return a.enabled !== false && trim(a.name); });
      var ids = {};
      cast.forEach(function (a) { ids[a.id] = slug(a.name); });
      return {
        ENSEMBLE: { prio: num(m.prio, 65), depth: int(m.depth, 3), maxActive: int(m.maxActive, 3), budget: int(m.budget, 1200), direction: trim(m.direction) },
        CAST: cast.map(function (a) {
          var rel = {}, cues = {};
          (a.relations || []).forEach(function (r) {
            var key = r.to === 'user' ? 'user' : ids[r.to];
            if (key) rel[key] = relationText(r);
          });
          EMOTIONS.forEach(function (e) { if (trim(a.cues && a.cues[e])) cues[e] = trim(a.cues[e]); });
          return Object.assign({
            id: slug(a.name), name: trim(a.name), aliases: splitKeys(a.aliases), presence: a.presence === 'always' ? 'always' : 'mentioned',
            snapshot: trim(a.snapshot), traits: oceanText(a), speech: speechText(a.speech), quirks: (a.quirks || []).slice(0, 12), cues: cues,
            focus: Math.max(1, int(a.focus, 30)), relations: rel
          }, keyOpts(a));
        })
      };
    },
    lorebook: function (m) {
      return {
        LORE: { prio: num(m.prio, 50), depth: int(m.depth, 3), limit: int(m.limit, 4), groupMode: m.groupMode === 'hits' ? 'hits' : 'weight' },
        LOREBOOK: (m.entries || []).filter(function (e) { return e.enabled !== false && trim(e.text) && (e.always || splitKeys(e.keys).length); }).map(function (e) {
          var o = { id: trim(e.id) || slug(e.name), keys: splitKeys(e.keys), target: e.target === 'personality' ? 'personality' : 'scenario', prio: num(e.prio, 10), text: trim(e.text) };
          if (trim(e.name)) o.name = trim(e.name);
          if (e.always) o.always = true;
          if (splitKeys(e.secondary).length) { o.secondary = splitKeys(e.secondary); o.logic = e.logic || 'AND_ANY'; }
          if (e.cs) o.cs = true;
          if (e.ww === false) o.ww = false;
          if (int(e.minMsg, 0)) o.minMsg = int(e.minMsg, 0);
          if (int(e.maxMsg, 0)) o.maxMsg = int(e.maxMsg, 0);
          if (num(e.prob, 100) < 100) o.prob = num(e.prob, 100);
          if (trim(e.group)) { o.group = trim(e.group); o.weight = num(e.weight, 100); }
          if (int(e.depth, 0)) o.depth = int(e.depth, 0);
          if (splitKeys(e.unlocks).length) o.unlocks = splitKeys(e.unlocks);
          if (m.forms && e.ww !== false) o.forms = true;
          return o;
        })
      };
    },
    pacing: function (m) {
      function t(x) { return x.target === 'personality' ? 'personality' : 'scenario'; }
      return { PACING: {
        prio: num(m.prio, 45), window: int(m.window, 1),
        phases: (m.phases || []).filter(function (x) { return trim(x.text); }).map(function (x) { return { from: int(x.from, 0), to: int(x.to, 0), target: t(x), text: trim(x.text) }; }),
        beats: (m.beats || []).filter(function (x) { return trim(x.text); }).map(function (x) { return { at: int(x.at, 0), target: t(x), text: trim(x.text) }; }),
        recurring: (m.recurring || []).filter(function (x) { return trim(x.text); }).map(function (x) { return { every: int(x.every, 10), from: int(x.from, 0), target: t(x), text: trim(x.text) }; }),
        foreshadow: (m.foreshadow || []).filter(function (x) { return trim(x.hint) || trim(x.payoff); }).map(function (x) { return { hint: trim(x.hint), from: int(x.from, 0), chance: num(x.chance, 35), payoffAt: int(x.payoffAt, 0), payoff: trim(x.payoff), target: t(x) }; })
      } };
    },
    random: function (m) {
      function outs(text) { return splitLines(text).map(function (l) { var mm = /^(.*?)\s*\|\s*(\d+(?:\.\d+)?)\s*$/.exec(l); return mm ? { text: mm[1], weight: parseFloat(mm[2]) } : { text: l, weight: 1 }; }); }
      return { RANDOM: {
        prio: num(m.prio, 30), depth: int(m.depth, 1),
        triggers: (m.triggers || []).filter(function (x) { return x.enabled !== false && splitKeys(x.keys).length && outs(x.outcomes).length; }).map(function (x) { return Object.assign({ keys: splitKeys(x.keys), chance: num(x.chance, 100), target: x.target === 'personality' ? 'personality' : 'scenario', minMsg: int(x.minMsg, 0), outcomes: outs(x.outcomes) }, keyOpts(x)); }),
        encounterChance: num(m.encounterChance, 0), encounterMin: int(m.encounterMin, 0), encounters: num(m.encounterChance, 0) > 0 ? outs(m.encounters) : [],
        diceTags: !!m.diceTags, pool: dicePool(m.pool)
      } };
    },
    ambient: function (m) {
      return { AMBIENT: { prio: num(m.prio, 20), chance: num(m.chance, 8), minMsg: int(m.minMsg, 0), list: (m.list || []).filter(function (a) { return trim(a.text); }).map(function (a) { var o = { text: trim(a.text), weight: num(a.weight, 1) }; var p = splitKeys(a.periods).map(slug); if (p.length) o.periods = p; return o; }) } };
    },
    rules: function (m) {
      return { RULES: (m.list || []).filter(function (r) { return r.enabled !== false && trim(r.text) && (r.conds || []).length; }).map(function (r) {
        return { name: trim(r.name) || 'rule', match: r.match === 'any' ? 'any' : 'all', target: r.target === 'personality' ? 'personality' : 'scenario', prio: num(r.prio, 75), text: trim(r.text), conds: (r.conds || []).map(condData).filter(Boolean) };
      }) };
    }
  };

  function condData(c) {
    var vals = function (v) { return splitKeys(v).map(function (x) { return x.toLowerCase(); }); };
    switch (c.type) {
      case 'keyword': return Object.assign({ type: 'keyword', keys: splitKeys(c.keys), mode: c.mode || 'any', depth: int(c.depth, 1) }, keyOpts(c));
      case 'messages': return { type: 'messages', min: int(c.min, 0), max: int(c.max, 0) };
      case 'period': return { type: 'period', values: vals(c.values).map(slug) };
      case 'weekday': return { type: 'weekday', values: vals(c.values) };
      case 'hour': return { type: 'hour', min: int(c.min, 0), max: int(c.max, 24) };
      case 'emotion': return { type: 'emotion', values: vals(c.values) };
      case 'state': return { type: 'state', values: vals(c.values).map(slug) };
      case 'meter': return { type: 'meter', meter: trim(c.meter), min: num(c.min, -9999), max: num(c.max, 9999) };
      case 'actor': return { type: 'actor', values: splitKeys(c.values) };
      case 'remembered': return { type: 'remembered', key: slug(c.key || 'name') };
      case 'fired': return { type: 'fired', tag: trim(c.tag) };
      case 'chance': return { type: 'chance', pct: num(c.pct, 50) };
    }
    return null;
  }

  var DATA_NOTES = {
    TIME: 'periods: name, from/to hour (24h, wraps past midnight), text.  days/seasons: optional text per weekday/season.',
    MEMORY: 'Phrases are matched case-insensitively; $1 in a template is the captured words.',
    EMOTIONS: 'lexicon: words per emotion (add your own).  reactions: what {{char}} does when that emotion wins.',
    STATES: 'One state per reply: most trigger hits wins.  escalated replaces text after escalateAt hits in the window.',
    METERS: 'up/down: {word, weight}.  tiers: from/to value range -> text.  growth: added per 10 messages.',
    ENSEMBLE: 'budget: characters shared by everyone on stage, split by focus.',
    CAST: 'presence "always" = always on stage, "mentioned" = joins when named.  relations: per other cast id, or user.',
    LORE: 'depth: messages scanned.  limit: most entries per reply.  groupMode: "weight" lottery or "hits" (most matched keys).',
    LOREBOOK: 'keys match whole words; /regex/ keys allowed.  logic: AND_ANY, AND_ALL, NOT_ANY, NOT_ALL for secondary keys.',
    PACING: 'phases: from/to message count (0 = open).  beats: one-time at message count.  recurring: every N messages.',
    RANDOM: 'triggers: keyword -> one weighted outcome.  encounters: encounterChance % per reply, then one weighted event.',
    AMBIENT: 'chance: % per reply.  periods: only during these time-of-day periods (needs Time module).',
    STATS: 'Stats are read back from the newest status line in the chat ("HP: 40").  changes: {word, weight} added when the word is in the latest message.',
    STYLE: 'phrases: worn-out wording to avoid; perTurn of them rotate in each reply.  echo: call out phrases the bot just used.',
    RULES: 'match "all" (AND) or "any" (OR).  Conditions read what earlier modules worked out this turn.'
  };

  /* ---------- compile ---------- */
  function header(p, ids) {
    var st = p.settings, lines = [];
    lines.push('/* ======================================================================== */');
    lines.push('/* ' + pad(s(p.meta.title || 'Janitor script'), 72) + ' */');
    lines.push('/* ======================================================================== */');
    lines.push('/*');
    if (trim(p.meta.character)) lines.push('   Character: ' + trim(p.meta.character));
    lines.push('   Made with JanitorAI Script Builder ' + VERSION + ' (offline, no API).');
    lines.push('');
    lines.push('   HOW TO USE');
    lines.push('     janitorai.com/scripts -> Create -> Advanced.  Paste this whole file,');
    lines.push('     save, then "Assign to your Characters".  Test in Test Chat with');
    lines.push('     "Show Debug Panel" -> Changes tab.  Set DEBUG = 1 to log decisions.');
    lines.push('');
    lines.push('   ES5 only (var, function, + strings).  Do not add let/const, arrow');
    lines.push('   functions or template strings: unsupported syntax makes Janitor skip');
    lines.push('   the script without any error.');
    lines.push('');
    lines.push('   Scripts are stateless.  Nothing survives between messages except what');
    lines.push('   is still in the chat, so "memory" and "meters" read recent messages.');
    lines.push('');
    lines.push('   MODULES: ' + ids.map(function (id) { return modName(id); }).join(', '));
    if (trim(p.meta.notes)) { lines.push(''); splitLines(p.meta.notes).forEach(function (l) { lines.push('   ' + l.replace(/\*\//g, '* /')); }); }
    lines.push('*/');
    return lines.join('\n') + '\n';
  }
  function pad(t, n) { t = t.replace(/\*\//g, '* /'); if (t.length > n) t = t.slice(0, n); while (t.length < n) t += ' '; return t; }
  function modName(id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i].name; return id; }
  function banner(t) { return '  /* ---------------------------------------------------------------------- */\n  /* ' + pad(t, 70) + ' */\n  /* ---------------------------------------------------------------------- */\n'; }

  function enabledIds(p) { return MODULE_IDS.filter(function (id) { return p.modules[id] && p.modules[id].enabled; }); }

  function compileIds(p, ids, titleSuffix) {
    var st = p.settings, out = [];
    var pp = clone(p);
    if (titleSuffix) pp.meta.title = (p.meta.title || 'Janitor script') + ' - ' + titleSuffix;
    out.push(header(pp, ids));
    out.push('(function () {');
    out.push(banner('GLOBAL KNOBS  >>> EDIT <<<'));
    function knob(name, value, note) { var l = '  var ' + name + ' = ' + value + ';'; while (l.length < 40) l += ' '; out.push(l + ' /* ' + note + ' */'); }
    knob('DEBUG', st.debug ? 1 : 0, '1 = log what fired to the debug panel');
    knob('MAX_CHARS', clampN(int(st.maxChars, 2500), 200, 60000), 'most characters added per reply (token budget)');
    knob('UTC_OFFSET', num(st.utcOffset, 0), 'Janitor runs on UTC. -5 = US Eastern, 1 = CET');
    knob('RANDOM_MODE', strLit(st.randomMode === 'stable' ? 'stable' : 'random'), '"stable" = rerolls keep the same dice');
    knob('LEAD_P', strLit(s(st.leadPersonality)), 'text before personality additions');
    knob('LEAD_S', strLit(s(st.leadScenario)), 'text before scenario additions');
    knob('JOIN', strLit(s(st.join)), 'separator between added pieces');
    out.push('  var SCRIPT_TAG = ' + strLit(trim(st.tag) || 'JSB') + ';');
    out.push('');
    out.push(banner('AUTHOR DATA  >>> EDIT <<<'));
    ids.forEach(function (id) {
      var data = BUILD[id](p.modules[id]);
      Object.keys(data).forEach(function (k) {
        if (DATA_NOTES[k]) out.push('  /* ' + DATA_NOTES[k] + ' */');
        out.push('  var ' + k + ' = ' + lit(data[k], '  ') + ';');
        out.push('');
      });
    });
    var compact = st.engine !== 'readable';
    out.push(banner('ENGINE  (no need to edit below this line)'));
    if (compact) out.push('  /* Compact engine. Choose "Readable" engine in the builder for the commented version. */');
    var eng = [RUNTIME.core].concat(ids.map(function (id) { return RUNTIME[id]; })).concat([RUNTIME.flush]);
    eng.forEach(function (src) { out.push(compact ? compactSource(src) : src); });
    out.push(banner('RUN'));
    var fn = { time: 'runTime', memory: 'runMemory', emotions: 'runEmotions', states: 'runStates', scoring: 'runScoring', stats: 'runStats', style: 'runStyle', ensemble: 'runEnsemble', lorebook: 'runLorebook', pacing: 'runPacing', random: 'runRandom', ambient: 'runAmbient', rules: 'runRules' };
    ids.forEach(function (id) { out.push('  safe("' + id + '", ' + fn[id] + ');'); });
    out.push('  safe("flush", flush);');
    out.push('})();');
    return out.join('\n') + '\n';
  }
  /* Strip comments and indentation from the engine.  Safe because the
     engine source never has comment markers inside strings or regexes
     (the test suite parses every compacted build as strict ES5). */
  function compactSource(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]+/gm, '  ').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').replace(/^\n+/, '');
  }
  function spaces(n) { var r = ' '; for (var i = 1; i < n; i++) r += ' '; return r; }
  function clampN(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /* Rules read other modules' results, so they stay in one script with
     every module they reference. */
  function ruleDeps(p) {
    var deps = {}, map = { period: 'time', weekday: 'time', hour: 'time', emotion: 'emotions', state: 'states', meter: 'scoring', actor: 'ensemble', remembered: 'memory' };
    (p.modules.rules.list || []).forEach(function (r) {
      (r.conds || []).forEach(function (c) {
        if (map[c.type]) deps[map[c.type]] = true;
        if (c.type === 'meter') deps.stats = true;
        if (c.type === 'fired') { var t = s(c.tag).split(':')[0]; var m2 = { time: 'time', day: 'time', season: 'time', memory: 'memory', emotion: 'emotions', state: 'states', meter: 'scoring', actor: 'ensemble', cast: 'ensemble', lore: 'lorebook', phase: 'pacing', beat: 'pacing', every: 'pacing', dice: 'random', encounter: 'random', ambient: 'ambient', rule: 'rules', stats: 'stats', style: 'style', hint: 'pacing', payoff: 'pacing', recap: 'memory', dicepool: 'random' }[t]; if (m2) deps[m2] = true; }
      });
    });
    /* Ambient period filters and ensemble emotion cues read other modules too. */
    return deps;
  }

  function compile(project) {
    var p = normalize(project), ids = enabledIds(p), scripts = [];
    if (!ids.length) {
      return { scripts: [{ name: 'main', title: p.meta.title, code: '/* Turn on at least one module to generate a script. */\n', modules: [] }], code: '/* Turn on at least one module to generate a script. */\n', modules: [] };
    }
    if (p.settings.split && ids.length > 1) {
      var main = [], rest = [];
      var deps = p.modules.rules.enabled ? ruleDeps(p) : {};
      if (p.modules.ambient.enabled && p.modules.time.enabled && (p.modules.ambient.list || []).some(function (a) { return trim(a.periods); })) { if (p.modules.rules.enabled) deps.time = true; else { main.push('time'); main.push('ambient'); } }
      if (p.modules.ensemble.enabled && p.modules.emotions.enabled) { main.push('emotions'); main.push('ensemble'); }
      ids.forEach(function (id) {
        if (id === 'rules' || deps[id]) { if (main.indexOf(id) === -1) main.push(id); }
      });
      ids.forEach(function (id) { if (main.indexOf(id) === -1) rest.push(id); });
      main = ids.filter(function (id) { return main.indexOf(id) !== -1; });
      if (main.length) scripts.push({ name: main.length === 1 ? main[0] : 'linked', title: main.map(modName).join(' + '), modules: main, code: compileIds(p, main, main.map(modName).join(' + ')) });
      rest.forEach(function (id) { scripts.push({ name: id, title: modName(id), modules: [id], code: compileIds(p, [id], modName(id)) }); });
    } else {
      scripts.push({ name: 'main', title: p.meta.title, modules: ids, code: compileIds(p, ids) });
    }
    return { scripts: scripts, code: scripts.map(function (x) { return x.code; }).join('\n'), modules: ids };
  }

  /* ---------- card blocks (Chatbot Creation Guide templates) ---------- */
  function cardBlocks(project) {
    var p = normalize(project), c = p.card, P = [], S = [];
    function line(arr, label, v) { v = trim(v); if (v) arr.push(label + ': ' + v.replace(/\n+/g, ' ')); }
    var who = trim(c.name) || trim(p.meta.character) || '{{char}}';
    var meta = [trim(c.age), trim(c.role)].filter(Boolean).join('; ');
    P.push('CHARACTER: ' + who + (meta ? ' (' + meta + ')' : ''));
    line(P, 'APPEARANCE', c.appearance);
    line(P, 'PSYCHOLOGICAL_PROFILE', c.psych);
    line(P, 'SOCIAL_BEHAVIOR', c.social);
    line(P, 'SENSORY', c.sensory);
    line(P, 'FORMAT', c.format);
    S.push('SETTING:');
    line(S, '  Location', c.location);
    line(S, '  Time/Context', c.timeContext);
    S.push('RELATIONSHIP_STATE:');
    line(S, '  User Relationship', c.userRelation);
    line(S, '  Trust Level', c.trustLevel);
    line(S, '  Conflict Level', c.conflictLevel);
    var cats = [['Neutral', c.neutral], ['Comfort', c.comfort], ['Affection', c.affection], ['Conflict', c.conflict], ['Teasing', c.teasing]].filter(function (x) { return trim(x[1]); });
    if (cats.length) { S.push('INTERACTION_CATEGORIES:'); cats.forEach(function (x) { line(S, '  ' + x[0], x[1]); }); }
    var trig = splitLines(c.triggers);
    if (c.useStates && p.modules.states.enabled) {
      (p.modules.states.list || []).forEach(function (st) {
        var k = splitKeys(st.keys).slice(0, 3);
        if (k.length && trim(st.text)) trig.push('If {{user}} says "' + k.join('" / "') + '" -> ' + trim(st.text));
      });
    }
    if (trig.length || trim(c.escalation) || trim(c.deescalation) || trim(c.repair)) {
      S.push('DYNAMIC_BEHAVIORS:');
      trig.forEach(function (t) { S.push('  Trigger: ' + t); });
      line(S, '  Escalation Paths', c.escalation);
      line(S, '  De-Escalation Paths', c.deescalation);
      line(S, '  Repair Cycles', c.repair);
    }
    S.push('PACING & STYLE:');
    line(S, '  Reply Length', c.replyLength);
    line(S, '  Tone Adjustments', c.tone);
    line(S, '  Scene Notes', c.sceneNotes);
    if (trim(c.format)) { S.push('FORMAT REMINDERS:'); S.push('  ' + trim(c.format)); }
    S = S.filter(function (l, i) { return !(/:$/.test(l) && (i === S.length - 1 || /^[A-Z_& ]+:$/.test(S[i + 1]))); });
    return { personality: P.join('\n'), scenario: S.join('\n') };
  }

  /* ---------- lorebook import / export ---------- */
  var LOGIC_FROM_ST = { 0: 'AND_ANY', 1: 'NOT_ALL', 2: 'NOT_ANY', 3: 'AND_ALL' };
  var LOGIC_TO_ST = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
  function importLorebook(input) {
    var data = typeof input === 'string' ? JSON.parse(input) : input;
    if (!data) throw new Error('Empty file');
    if (data.spec && data.data) data = data.data;                       /* V2/V3 card wrapper */
    if (data.character_book) data = data.character_book;                 /* card with a book */
    if (data.data && data.data.character_book) data = data.data.character_book;
    var entries = Array.isArray(data) ? data : data.entries || (Array.isArray(data.data) ? data.data : null);
    if (!entries) throw new Error('No "entries" found. Expected a SillyTavern World Info, a V2 character_book, or a Janitor lorebook JSON.');
    if (!Array.isArray(entries)) entries = Object.keys(entries).map(function (k) { return entries[k]; });
    var list = [];
    function arr(v) { return Array.isArray(v) ? v.map(s).filter(function (x) { return trim(x); }) : splitKeys(v); }
    function first() { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i]; return undefined; }
    entries.forEach(function (e, i) {
      if (!e || typeof e !== 'object') return;
      var ext = e.extensions && typeof e.extensions === 'object' ? e.extensions : {};
      var keys = arr(first(e.keys, e.key, e.keywords, e.triggers, ''));
      var sec = arr(first(e.secondary_keys, e.keysecondary, e.secondkey, e.secondaryKeys, ''));
      var name = s(first(e.comment, e.name, e.displayName, e.title, e.memo, ''));
      var logicRaw = first(e.selectiveLogic, ext.selectiveLogic, 0);
      var prob = first(e.probability, ext.probability, e.prob, 100);
      if (typeof prob === 'number' && prob > 0 && prob < 1) prob = Math.round(prob * 100);
      var useProb = first(e.useProbability, ext.useProbability, true);
      var target = /personality|char/i.test(s(first(e.target, ''))) ? 'personality' : 'scenario';
      var o = newLore({
        id: slug(name || ('entry_' + (e.uid !== undefined ? e.uid : e.id !== undefined ? e.id : i))) + '_' + i,
        name: name,
        keys: keys.join(', '),
        secondary: sec.join(', '),
        logic: typeof logicRaw === 'string' && LOGIC_TO_ST[logicRaw.toUpperCase()] !== undefined ? logicRaw.toUpperCase() : (LOGIC_FROM_ST[logicRaw] || 'AND_ANY'),
        cs: !!first(e.case_sensitive, e.caseSensitive, ext.case_sensitive, false),
        ww: !(first(e.matchWholeWords, ext.match_whole_words) === false),
        prio: num(first(e.priority, e.order, e.insertion_order, e.insertionOrder, e.weight !== undefined && e.entry !== undefined ? e.weight : undefined), 10),
        minMsg: int(first(e.minMessages, e.minMsg, ext.min_messages), 0),
        prob: useProb === false ? 100 : num(prob, 100),
        group: s(first(e.group, ext.group, '')),
        weight: num(first(e.groupWeight, ext.group_weight), 100),
        always: !!first(e.constant, e.alwaysActive, e.forceActivation, false),
        depth: int(first(e.depth, e.scanDepth, ext.scan_depth, ext.depth), 0),
        text: s(first(e.content, e.entry, e.text, e.value, '')),
        enabled: !(e.disable === true || e.disabled === true || e.enabled === false),
        comment: s(e.comment && e.comment !== name ? e.comment : ''),
        target: target
      });
      if (trim(o.text) || keys.length) list.push(o);
    });
    return list;
  }

  /* Janitor's Lorebook script JSON editor takes the contents of a SillyTavern
     style entries array, so that is what this exports. */
  function exportLorebook(project) {
    var p = normalize(project);
    return (p.modules.lorebook.entries || []).map(function (e, i) {
      return {
        uid: i, key: splitKeys(e.keys), keysecondary: splitKeys(e.secondary), comment: trim(e.name) || trim(e.id), content: trim(e.text),
        constant: !!e.always, selective: splitKeys(e.secondary).length > 0, selectiveLogic: LOGIC_TO_ST[e.logic] || 0,
        order: num(e.prio, 10), position: 0, disable: e.enabled === false, probability: num(e.prob, 100), useProbability: num(e.prob, 100) < 100,
        depth: int(e.depth, 0) || 4, group: trim(e.group), groupWeight: num(e.weight, 100), caseSensitive: !!e.cs, matchWholeWords: e.ww !== false
      };
    });
  }

  /* ---------- analyzer ---------- */
  var COMMON = ' the a an and or but if then so to of in on at by for with from up down out over under again here there when where why how all any both each few more most other some such no nor not only own same than too very can will just dont should now is are was were be been being have has had do does did i you he she it we they me him her us them my your his its our their this that these those what which who whom am im hi hello hey yes yeah ok okay sure thanks thank please good bad well like get got go going come came see look know think want need make made take give say said tell one two time day way thing man woman people really much many back still also even new old big small little right left ';
  function analyze(project, compiled) {
    var p = normalize(project), F = [], M = p.modules;
    function add(level, mod, msg, hint) { F.push({ level: level, module: mod, message: msg, hint: hint || '' }); }
    var keyUse = {};
    function track(keys, where) { splitKeys(keys).forEach(function (k) { var kk = k.toLowerCase(); (keyUse[kk] = keyUse[kk] || []).push(where); }); }
    function checkKeys(keys, mod, label, opts) {
      splitKeys(keys).forEach(function (k) {
        if (/^\/.+\/[gimy]*$/.test(k)) {
          try { var mm = /^\/(.+)\/([gimy]*)$/.exec(k); new RegExp(mm[1], mm[2]); } catch (e) { add('error', mod, label + ': regex key ' + k + ' is invalid (' + e.message + ').', 'Fix the pattern or remove the slashes.'); }
          if (/\(\?<[=!]/.test(k)) add('warn', mod, label + ': ' + k + ' uses lookbehind, which may not work in Janitor\'s engine.');
          return;
        }
        var low = k.toLowerCase();
        if (COMMON.indexOf(' ' + low + ' ') !== -1) add('warn', mod, label + ': "' + k + '" is an everyday word and will fire constantly.', 'Use a more specific word or phrase.');
        else if (low.length < 3 && !/^[A-Z0-9]{2,}$/.test(k)) add('warn', mod, label + ': "' + k + '" is very short.', 'Short keys match too often. Use longer keys or keep acronyms in capitals with Case Sensitive on.');
        if (opts && opts.ww === false && low.length < 5) add('info', mod, label + ': "' + k + '" matches inside other words (whole word is off).', 'e.g. "sad" also fires on "salad".');
      });
    }
    /* Lorebook */
    if (M.lorebook.enabled) {
      var ids = {};
      (M.lorebook.entries || []).forEach(function (e) { ids[trim(e.id)] = (ids[trim(e.id)] || 0) + 1; });
      (M.lorebook.entries || []).forEach(function (e, i) {
        var label = 'Entry "' + (trim(e.name) || trim(e.id) || '#' + (i + 1)) + '"';
        if (e.enabled === false) return;
        if (ids[trim(e.id)] > 1) add('error', 'lorebook', label + ': id "' + e.id + '" is used more than once.', 'Unlocks point at ids, so ids must be unique.');
        if (!trim(e.text)) add('warn', 'lorebook', label + ': no text, so it never adds anything.');
        if (!e.always && !splitKeys(e.keys).length) add('error', 'lorebook', label + ': no keys and not "always on", so it can never fire.');
        if (int(e.maxMsg, 0) && int(e.minMsg, 0) > int(e.maxMsg, 0)) add('error', 'lorebook', label + ': min messages is above max messages, so it can never fire.');
        if (num(e.prob, 100) <= 0) add('warn', 'lorebook', label + ': probability is 0%.');
        if (trim(e.group) && num(e.prob, 100) < 100) add('info', 'lorebook', label + ': grouped and below 100% probability. Janitor\'s help center advises 100% for grouped entries to avoid double randomness.');
        checkKeys(e.keys, 'lorebook', label, e); checkKeys(e.secondary, 'lorebook', label + ' (secondary)', e);
        track(e.keys, trim(e.group) ? 'Lorebook group ' + trim(e.group) : 'Lorebook: ' + (trim(e.name) || e.id));
        splitKeys(e.unlocks).forEach(function (u) { if (!ids[u]) add('error', 'lorebook', label + ': unlocks "' + u + '", but no entry has that id.'); });
        var depth = int(e.depth, 0) || int(M.lorebook.depth, 3);
        if (depth > 1) {
          var flatText = ' ' + trim(e.text).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
          var echo = splitKeys(e.keys).filter(function (k) { return k.charAt(0) !== '/' && flatText.indexOf(' ' + k.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ') !== -1; });
          if (echo.length) add('info', 'lorebook', label + ': its text contains its own key' + (echo.length > 1 ? 's "' : ' "') + echo.join('", "') + '". If last_messages includes the bot\'s replies, the entry can keep re-firing while scan depth is ' + depth + '.', 'Harmless for most lore. Set this entry\'s depth to 1 if it loops.');
        }
      });
    }
    if (M.states.enabled) (M.states.list || []).forEach(function (st) {
      if (st.enabled === false) return;
      var label = 'State "' + (trim(st.name) || '?') + '"';
      if (!splitKeys(st.keys).length) add('error', 'states', label + ': no trigger keys.');
      if (!trim(st.text)) add('warn', 'states', label + ': no text.');
      checkKeys(st.keys, 'states', label, st); track(st.keys, 'State: ' + st.name);
    });
    if (M.random.enabled) (M.random.triggers || []).forEach(function (t, i) { checkKeys(t.keys, 'random', 'Dice #' + (i + 1), t); track(t.keys, 'Dice #' + (i + 1)); if (!splitLines(t.outcomes).length) add('warn', 'random', 'Dice #' + (i + 1) + ': no outcomes.'); });
    if (M.scoring.enabled) (M.scoring.meters || []).forEach(function (m) {
      var up = weighted(m.up).map(function (w) { return w.word.toLowerCase(); }), down = weighted(m.down).map(function (w) { return w.word.toLowerCase(); });
      up.forEach(function (w) { if (down.indexOf(w) !== -1) add('error', 'scoring', 'Meter "' + m.name + '": "' + w + '" is in both the up and down lists, so it cancels out.'); });
      if (num(m.min, -100) >= num(m.max, 100)) add('error', 'scoring', 'Meter "' + m.name + '": min must be below max.');
      if (!(m.tiers || []).length && !m.show) add('warn', 'scoring', 'Meter "' + m.name + '": no tiers and not shown, so the value never reaches the bot.');
      if (m.carry) add('info', 'scoring', 'Meter "' + m.name + '": carry-over depends on the bot writing the [' + m.name + ': N] tag every reply. It is fragile and visible in chat.');
      var st = num(m.start, 0); if (st < num(m.min, -100) || st > num(m.max, 100)) add('warn', 'scoring', 'Meter "' + m.name + '": start value is outside min/max.');
    });
    if (M.ensemble.enabled) {
      var cast = (M.ensemble.cast || []).filter(function (a) { return a.enabled !== false; });
      if (!cast.length) add('warn', 'ensemble', 'Ensemble is on but has no cast.');
      cast.forEach(function (a) { if (!trim(a.snapshot)) add('info', 'ensemble', '"' + a.name + '" has no snapshot line. One short line ("Bartender, 30s, dry wit") anchors the voice.'); });
      if (!cast.some(function (a) { return a.presence === 'always'; }) && cast.length) add('info', 'ensemble', 'No cast member is "always on stage", so the cast only appears when named.');
    }
    if (M.ambient.enabled && (M.ambient.list || []).some(function (a) { return trim(a.periods); }) && !M.time.enabled) add('error', 'ambient', 'Some ambient lines are limited to time periods, but the Time module is off, so they never play.');
    if (M.memory.enabled && int(M.memory.depth, 10) > 1) add('info', 'memory', 'Memory reads ' + int(M.memory.depth, 10) + ' messages back. That relies on context.chat.last_messages, which is community-reported; without it, memory sees only the latest message.');
    /* Rules */
    if (M.rules.enabled) {
      var states = (M.states.list || []).map(function (x) { return slug(x.name); }).concat([slug(M.states.fallbackName || 'neutral')]);
      var meters = (M.scoring.meters || []).map(function (x) { return trim(x.name); });
      var actors = (M.ensemble.cast || []).map(function (x) { return trim(x.name); });
      var periods = (M.time.periods || []).map(function (x) { return slug(x.name); });
      (M.rules.list || []).forEach(function (r) {
        var label = 'Rule "' + (trim(r.name) || '?') + '"';
        if (!(r.conds || []).length) add('warn', 'rules', label + ': no conditions.');
        if (!trim(r.text)) add('warn', 'rules', label + ': no text.');
        (r.conds || []).forEach(function (c) {
          if ((c.type === 'period' || c.type === 'weekday' || c.type === 'hour') && !M.time.enabled) add('error', 'rules', label + ': uses time, but the Time module is off.');
          if (c.type === 'period') splitKeys(c.values).forEach(function (v) { if (periods.indexOf(slug(v)) === -1) add('error', 'rules', label + ': period "' + v + '" is not defined in Time.'); });
          if (c.type === 'emotion' && !M.emotions.enabled) add('error', 'rules', label + ': uses emotion, but the Emotion Engine is off.');
          if (c.type === 'emotion') splitKeys(c.values).forEach(function (v) { if (EMOTIONS.indexOf(v.toLowerCase()) === -1) add('error', 'rules', label + ': "' + v + '" is not one of ' + EMOTIONS.join(', ') + '.'); });
          if (c.type === 'state' && !M.states.enabled) add('error', 'rules', label + ': uses a state, but States is off.');
          if (c.type === 'state') splitKeys(c.values).forEach(function (v) { if (states.indexOf(slug(v)) === -1) add('error', 'rules', label + ': state "' + v + '" does not exist.'); });
          if (c.type === 'meter') {
            var isMeter = M.scoring.enabled && meters.indexOf(trim(c.meter)) !== -1;
            var isStat = M.stats.enabled && (M.stats.list || []).some(function (x) { return x.enabled !== false && trim(x.name).replace(/[:=|]/g, '') === trim(c.meter); });
            if (!isMeter && !isStat) add('error', 'rules', label + ': "' + c.meter + '" is not a meter or stat that is switched on.');
          }
          if (c.type === 'actor' && (!M.ensemble.enabled || splitKeys(c.values).some(function (v) { return actors.indexOf(v) === -1; }))) add('error', 'rules', label + ': a cast member it names does not exist or Ensemble is off.');
          if (c.type === 'remembered' && !M.memory.enabled) add('error', 'rules', label + ': uses memory, but Memory is off.');
          if (c.type === 'keyword') { checkKeys(c.keys, 'rules', label, c); track(c.keys, 'Rule: ' + r.name); }
          if (c.type === 'messages' && int(c.max, 0) && int(c.min, 0) > int(c.max, 0)) add('error', 'rules', label + ': message range min is above max.');
        });
      });
    }
    if (M.pacing.enabled) (M.pacing.phases || []).forEach(function (ph, i) { if (int(ph.to, 0) && int(ph.from, 0) > int(ph.to, 0)) add('error', 'pacing', 'Phase #' + (i + 1) + ': from is above to.'); });
    /* Overlaps */
    Object.keys(keyUse).forEach(function (k) {
      var owners = keyUse[k].filter(function (w, i, arr) { return arr.indexOf(w) === i; });
      if (owners.length > 1 && !owners.every(function (w) { return /^Lorebook group /.test(w) && w === owners[0]; })) add('info', 'analyzer', 'Key "' + k + '" fires ' + keyUse[k].length + ' things: ' + keyUse[k].join('; ') + '.', 'Fine if intended, but it adds up on one message.');
    });
    var keys = Object.keys(keyUse).filter(function (k) { return k.charAt(0) !== '/'; });
    keys.forEach(function (a) { keys.forEach(function (b) { if (a !== b && b.length > a.length && (' ' + b + ' ').indexOf(' ' + a + ' ') !== -1 && keyUse[a].join() !== keyUse[b].join()) add('info', 'analyzer', 'Key "' + a + '" is part of the phrase "' + b + '", so "' + b + '" also triggers "' + a + '" (' + keyUse[a].join('; ') + ').'); }); });
    /* Budget */
    var always = 0;
    if (M.lorebook.enabled) (M.lorebook.entries || []).forEach(function (e) { if (e.always && e.enabled !== false) always += trim(e.text).length; });
    if (M.time.enabled) always += Math.max.apply(null, [0].concat((M.time.periods || []).map(function (x) { return trim(x.text).length; })));
    if (M.states.enabled) always += trim(M.states.fallback).length;
    if (M.ensemble.enabled && (M.ensemble.cast || []).some(function (a) { return a.presence === 'always'; })) always += Math.min(int(M.ensemble.budget, 1200), 1200);
    var max = int(p.settings.maxChars, 2500);
    if (always > max) add('warn', 'budget', 'Always-on text (~' + always + ' chars) is more than MAX_CHARS (' + max + '). Keyword entries will be crowded out.', 'Raise MAX_CHARS or trim always-on text.');
    else if (always > max * 0.7) add('info', 'budget', 'Always-on text uses ~' + Math.round(always / max * 100) + '% of MAX_CHARS, leaving little room for keyword triggers.');
    if (max > 4000) add('info', 'budget', 'MAX_CHARS ' + max + ' is about ' + Math.round(max / 4) + ' tokens every reply. Community guidance is to keep active injected text under ~2,500 tokens.');
    if (compiled) compiled.scripts.forEach(function (sc) {
      if (sc.code.length > 60000) add('warn', 'size', 'Script "' + sc.title + '" is ' + sc.code.length + ' characters. Janitor accepts large scripts, but if yours will not save, turn on "Split into separate scripts" in Start & settings.');
      else if (sc.code.length > 10000) add('info', 'size', 'Script "' + sc.title + '" is ' + sc.code.length + ' characters. That is fine since the 2025 limits raise, but split mode keeps each script smaller.');
    });
    var order = { error: 0, warn: 1, info: 2 };
    F.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return F;
  }

  return {
    VERSION: VERSION, MODULES: MODULES, MODULE_IDS: MODULE_IDS, EMOTIONS: EMOTIONS, EMOTION_LABELS: EMOTION_LABELS, LEXICON: LEXICON,
    QUIRKS: QUIRKS, CUE_DEFAULTS: CUE_DEFAULTS, REL_PRESETS: REL_PRESETS, SPEECH: SPEECH, TEMPERAMENTS: TEMPERAMENTS, WEEKDAYS: WEEKDAYS, SEASONS: SEASONS,
    defaultProject: defaultProject, normalize: normalize, compile: compile, analyze: analyze, cardBlocks: cardBlocks,
    importLorebook: importLorebook, exportLorebook: exportLorebook, newLore: newLore, newActor: newActor, newRelation: newRelation,
    splitKeys: splitKeys, uid: uid, slug: slug, oceanText: oceanText, speechText: speechText, relationText: relationText, lit: lit
  };
});
