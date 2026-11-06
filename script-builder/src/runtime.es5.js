//@@ core
  /* ---------------------------------------------------------------------- */
  /* OUTPUT GUARDS                                                          */
  /* ---------------------------------------------------------------------- */
  /* Only personality and scenario reach the model.  Both must be strings
     before anything is appended, or "undefined" ends up in the prompt. */
  if (typeof context === "undefined" || !context) { return; }
  if (!context.character) { context.character = {}; }
  if (!context.chat) { context.chat = {}; }
  if (typeof context.character.personality !== "string") { context.character.personality = ""; }
  if (typeof context.character.scenario !== "string") { context.character.scenario = ""; }

  /* ---------------------------------------------------------------------- */
  /* UTILITIES                                                              */
  /* ---------------------------------------------------------------------- */
  function str(x) { return (x === undefined || x === null) ? "" : String(x); }

  function clampInt(value, low, high, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) { return fallback; }
    if (n < low) { return low; }
    if (n > high) { return high; }
    return n;
  }

  function note(line) {
    if (DEBUG && typeof console !== "undefined" && console && console.log) {
      console.log("[" + SCRIPT_TAG + "] " + line);
    }
  }

  function has(list, value) {
    var i;
    if (!list) { return false; }
    for (i = 0; i < list.length; i++) { if (list[i] === value) { return true; } }
    return false;
  }

  /* Flatten punctuation and whitespace to single spaces, keep letters in any
     alphabet, drop apostrophes so "can't" and "cant" compare equal. */
  function flatten(text, cased) {
    var s = str(text);
    if (!cased) { s = s.toLowerCase(); }
    s = s.replace(/['\u2019\u2018\x60]/g, "");
    s = s.replace(/[\s.,!?;:"\u201c\u201d()\[\]{}<>\/\\|@#$%\^&*+=~_\u2026\u2014\u2013\-]+/g, " ");
    return " " + s.replace(/^\s+|\s+$/g, "") + " ";
  }

  /* A tiny deterministic hash, used for stable rolls and quirk rotation. */
  function hash(text) {
    var s = str(text), h = 2166136261, i;
    for (i = 0; i < s.length; i++) {
      h = h ^ s.charCodeAt(i);
      h = (h * 16777619) % 4294967296;
      if (h < 0) { h = h + 4294967296; }
    }
    return h;
  }

  var MSG_COUNT = clampInt(context.chat.message_count, 0, 999999999, 0);
  var LAST_RAW = str(context.chat.last_message);

  /* "random" rolls fresh dice every time.  "stable" gives the same result for
     the same message, so a reroll keeps the same event. */
  var ROLL_SEED = hash(MSG_COUNT + "|" + LAST_RAW);
  var ROLLS = 0;
  function roll() {
    ROLLS = ROLLS + 1;
    if (RANDOM_MODE === "stable") {
      var x = Math.sin(ROLL_SEED + ROLLS * 7919) * 10000;
      return x - Math.floor(x);
    }
    return Math.random();
  }
  function chance(pct) {
    var p = parseFloat(pct);
    if (isNaN(p)) { return true; }
    if (p >= 100) { return true; }
    if (p <= 0) { return false; }
    return roll() * 100 < p;
  }
  function pickWeighted(list) {
    var total = 0, i, w, r;
    if (!list || !list.length) { return null; }
    for (i = 0; i < list.length; i++) {
      w = parseFloat(list[i].weight);
      if (isNaN(w) || w < 0) { w = 1; }
      total = total + w;
    }
    if (total <= 0) { return list[0]; }
    r = roll() * total;
    for (i = 0; i < list.length; i++) {
      w = parseFloat(list[i].weight);
      if (isNaN(w) || w < 0) { w = 1; }
      if (r < w) { return list[i]; }
      r = r - w;
    }
    return list[list.length - 1];
  }

  function gateOpen(min, max) {
    var lo = clampInt(min, 0, 999999999, 0);
    var hi = clampInt(max, 0, 999999999, 0);
    if (lo > 0 && MSG_COUNT < lo) { return false; }
    if (hi > 0 && MSG_COUNT > hi) { return false; }
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* INPUT NORMALIZATION                                                    */
  /* ---------------------------------------------------------------------- */
  /* context.chat.last_message is documented.  context.chat.last_messages is
     community-reported, so it is used when present and ignored otherwise.
     Items can be strings or objects with a message/text/content field. */
  function itemText(item) {
    if (typeof item === "string") { return item; }
    if (item && typeof item === "object") {
      if (typeof item.message === "string") { return item.message; }
      if (typeof item.text === "string") { return item.text; }
      if (typeof item.content === "string") { return item.content; }
      if (typeof item.mes === "string") { return item.mes; }
    }
    return "";
  }

  var HISTORY = (function () {
    var out = [], list = context.chat.last_messages, i, t;
    if (list && typeof list.length === "number") {
      for (i = 0; i < list.length; i++) {
        t = itemText(list[i]);
        if (t) { out.push(t); }
      }
    }
    if (LAST_RAW && (!out.length || out[out.length - 1] !== LAST_RAW)) { out.push(LAST_RAW); }
    return out;
  })();

  var HAY_CACHE = {};
  function rawWindow(depth) {
    var d = clampInt(depth, 1, 50, 1);
    var start = HISTORY.length - d;
    if (start < 0) { start = 0; }
    return HISTORY.slice(start).join(" \n ");
  }
  function hay(depth, cased) {
    var d = clampInt(depth, 1, 50, 1);
    var k = d + (cased ? "c" : "l");
    if (HAY_CACHE[k] === undefined) { HAY_CACHE[k] = flatten(rawWindow(d), cased); }
    return HAY_CACHE[k];
  }

  /* ---------------------------------------------------------------------- */
  /* KEYWORD MATCHING                                                       */
  /* ---------------------------------------------------------------------- */
  /* A key written as /pattern/flags is a regular expression tested against
     the raw text.  Otherwise keys match whole words by default, so "cross"
     does not fire inside "across". */
  var RX_CACHE = {};
  function keyRegex(key) {
    var m, rx;
    if (RX_CACHE[key] !== undefined) { return RX_CACHE[key]; }
    m = /^\/(.+)\/([gimy]*)$/.exec(key);
    rx = null;
    if (m) {
      try { rx = new RegExp(m[1], m[2].replace("g", "")); } catch (e) { rx = null; note("bad regex key " + key); }
    }
    RX_CACHE[key] = rx;
    return rx;
  }

  function countKey(key, depth, opts) {
    var k = str(key), cased = opts && opts.cs, whole = !(opts && opts.ww === false);
    var rx, h, needle, n = 0, at;
    if (!k) { return 0; }
    if (k.charAt(0) === "/" && k.length > 2) {
      rx = keyRegex(k);
      if (rx) { return rx.test(rawWindow(depth)) ? 1 : 0; }
    }
    h = hay(depth, cased);
    needle = flatten(k, cased);
    if (needle === "  ") { return 0; }
    if (whole && opts && opts.forms) {
      rx = formsRegex(needle);
      if (rx) {
        rx.lastIndex = 0;
        while (rx.exec(h) && n < 50) { n = n + 1; rx.lastIndex = rx.lastIndex - 1; }
        return n;
      }
    }
    if (!whole) { needle = needle.slice(1, needle.length - 1); }
    at = h.indexOf(needle);
    while (at !== -1 && n < 50) {
      n = n + 1;
      at = h.indexOf(needle, at + Math.max(1, needle.length - 1));
    }
    return n;
  }

  /* Word forms: "sword" also matches "swords", "wolf" matches "wolfs",
     "city" matches "cities", "dance" matches "dancing".  Only the last
     word of a key changes, and only for plain (non-regex) keys. */
  function formsRegex(needle) {
    var cacheKey = "~" + needle, w, stem, esc, tail;
    if (RX_CACHE[cacheKey] !== undefined) { return RX_CACHE[cacheKey]; }
    w = needle.slice(1, needle.length - 1);
    stem = w;
    if (stem.length > 4 && /ies$/.test(stem)) { stem = stem.slice(0, stem.length - 3) + "y"; }
    else if (stem.length > 3 && /[^s]s$/.test(stem)) { stem = stem.slice(0, stem.length - 1); }
    esc = stem.replace(/[.+?^$|(){}\[\]\\]/g, "\\$&");
    if (/[^aeiou]y$/.test(stem)) { tail = esc.slice(0, esc.length - 1) + "(?:y|ies|ied|ying)"; }
    else if (/e$/.test(stem) && stem.length > 3) { tail = "(?:" + esc + "(?:s|d)?|" + esc.slice(0, esc.length - 1) + "ing)"; }
    else { tail = esc + "(?:s|es|ed|ing)?"; }
    try { RX_CACHE[cacheKey] = new RegExp(" " + tail + " ", "g"); } catch (e) { RX_CACHE[cacheKey] = null; }
    return RX_CACHE[cacheKey];
  }

  function countKeys(keys, depth, opts) {
    var total = 0, i;
    if (!keys || !keys.length) { return 0; }
    for (i = 0; i < keys.length; i++) { if (countKey(keys[i], depth, opts) > 0) { total = total + 1; } }
    return total;
  }

  /* Polarity: +1 for each plain mention, -1 for each negated mention
     ("not happy", "never liked"), looking two words back. */
  var NEGATORS = " not no never dont doesnt didnt isnt arent wasnt werent cant cannot couldnt wont wouldnt shouldnt hardly barely without nor ";
  function polarity(word, depth) {
    var h = hay(depth, false), needle = flatten(word, false), at, score = 0, before, words, j, neg, guard = 0;
    if (needle === "  ") { return 0; }
    at = h.indexOf(needle);
    while (at !== -1 && guard < 50) {
      guard = guard + 1;
      before = h.slice(Math.max(0, at - 40), at + 1);
      words = before.replace(/^\s+|\s+$/g, "").split(" ");
      neg = false;
      for (j = words.length - 1; j >= 0 && j >= words.length - 2; j--) {
        if (words[j] && NEGATORS.indexOf(" " + words[j] + " ") !== -1) { neg = true; }
      }
      score = score + (neg ? -1 : 1);
      at = h.indexOf(needle, at + Math.max(1, needle.length - 1));
    }
    return score;
  }

  /* ---------------------------------------------------------------------- */
  /* SHARED STATE (read by Combined Rules)                                  */
  /* ---------------------------------------------------------------------- */
  var STATE = { messages: MSG_COUNT, period: "", hour: -1, weekday: "", emotion: "", emotionScore: 0, mood: "", scores: {}, tiers: {}, actors: [], memory: {}, fired: {} };

  /* ---------------------------------------------------------------------- */
  /* OUTPUT QUEUE                                                           */
  /* ---------------------------------------------------------------------- */
  /* Every module queues its text here.  FLUSH keeps the highest priority
     pieces that fit in MAX_CHARS, so one busy turn cannot flood the prompt. */
  var OUT = [];
  function emit(target, text, prio, tag) {
    var t = str(text);
    if (!t) { return; }
    OUT.push({ target: target === "personality" ? "personality" : "scenario", text: t, prio: parseFloat(prio) || 0, tag: str(tag), order: OUT.length });
    if (tag) { STATE.fired[tag] = true; }
  }

  /* Each module runs in its own try/catch, so one bad value cannot take the
     rest of the script down with it.  Errors always reach the debug log. */
  function safe(name, fn) {
    try { fn(); } catch (e) {
      if (typeof console !== "undefined" && console && console.log) { console.log("[" + SCRIPT_TAG + "] " + name + " error: " + (e && e.message ? e.message : e)); }
    }
  }

//@@ time
  /* ---------------------------------------------------------------------- */
  /* MODULE: TIME & ENVIRONMENT                                             */
  /* ---------------------------------------------------------------------- */
  /* Janitor's servers run on UTC.  UTC_OFFSET (in GLOBAL KNOBS) shifts the
     clock to the story's time zone, for example -5 for US Eastern. */
  function runTime() {
    var now = new Date();
    var shifted = new Date(now.getTime() + (parseFloat(UTC_OFFSET) || 0) * 3600000);
    var hour = shifted.getUTCHours(), day = shifted.getUTCDay(), month = shifted.getUTCMonth();
    var names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    var i, p, from, to, inside, season;
    STATE.hour = hour;
    STATE.weekday = names[day];
    for (i = 0; i < TIME.periods.length; i++) {
      p = TIME.periods[i];
      from = clampInt(p.from, 0, 24, 0);
      to = clampInt(p.to, 0, 24, 0);
      inside = from <= to ? (hour >= from && hour < to) : (hour >= from || hour < to);
      if (inside) {
        STATE.period = p.name;
        emit(p.target || TIME.target, p.text, TIME.prio, "time:" + p.name);
        break;
      }
    }
    if (TIME.days && TIME.days[names[day]]) { emit(TIME.target, TIME.days[names[day]], TIME.prio - 1, "day:" + names[day]); }
    if (TIME.seasons) {
      season = (month === 11 || month < 2) ? "winter" : (month < 5 ? "spring" : (month < 8 ? "summer" : "autumn"));
      if (TIME.southern) {
        season = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" }[season];
      }
      STATE.season = season;
      if (TIME.seasons[season]) { emit(TIME.target, TIME.seasons[season], TIME.prio - 2, "season:" + season); }
    }
    if (TIME.clock) {
      emit("scenario", "Current local time: " + (hour < 10 ? "0" : "") + hour + ":" + (shifted.getUTCMinutes() < 10 ? "0" : "") + shifted.getUTCMinutes() + " on " + names[day] + ".", TIME.prio - 3, "clock");
    }
    note("time " + hour + "h " + names[day] + " period=" + STATE.period);
  }

//@@ memory
  /* ---------------------------------------------------------------------- */
  /* MODULE: MEMORY                                                         */
  /* ---------------------------------------------------------------------- */
  /* Scripts are stateless: this "remembers" only what is still inside the
     scanned window of recent messages.  Larger MEMORY.depth = longer memory,
     when context.chat.last_messages is available. */
  function captureAfter(raw, phrases, maxWords) {
    var out = [], low, i, at, rest, m, guard;
    low = raw.toLowerCase();
    for (i = 0; i < phrases.length; i++) {
      at = low.indexOf(str(phrases[i]).toLowerCase());
      guard = 0;
      while (at !== -1 && guard < 10) {
        guard = guard + 1;
        if (at === 0 || /[^a-z0-9]/.test(low.charAt(at - 1))) {
          rest = raw.slice(at + phrases[i].length);
          m = /^\s+([^.,!?;:\n()"]+)/.exec(rest);
          if (m) {
            var words = m[1].split(/\s+/), keep = [], j;
            for (j = 0; j < words.length && keep.length < maxWords; j++) {
              if (/^(and|but|because|so|though|although|when|if|or|too|lol)$/i.test(words[j])) { break; }
              keep.push(words[j]);
            }
            if (keep.length) { out.push(keep.join(" ")); }
          }
        }
        at = low.indexOf(str(phrases[i]).toLowerCase(), at + 1);
      }
    }
    return out;
  }

  function addUnique(list, value, cap) {
    var v = str(value).replace(/^\s+|\s+$/g, ""), i;
    if (!v) { return; }
    for (i = 0; i < list.length; i++) { if (list[i].toLowerCase() === v.toLowerCase()) { return; } }
    if (list.length < cap) { list.push(v); }
  }

  function runMemory() {
    var raw = rawWindow(MEMORY.depth), names = [], likes = [], dislikes = [], fears = [], i, j, found, lines = [], f;
    if (MEMORY.captureName) {
      found = captureAfter(raw, MEMORY.namePhrases, 1);
      for (i = 0; i < found.length; i++) {
        if (/^[A-Z\u00c0-\u024f][A-Za-z\u00c0-\u024f'\-]{0,23}$/.test(found[i])) { addUnique(names, found[i], 1); }
      }
      if (names.length) {
        STATE.memory.name = names[0];
        lines.push(MEMORY.nameTemplate.replace(/\$1/g, names[0]));
      }
    }
    if (MEMORY.capturePrefs) {
      found = captureAfter(raw, MEMORY.likePhrases, 4);
      for (i = 0; i < found.length; i++) { addUnique(likes, found[i], MEMORY.maxItems); }
      found = captureAfter(raw, MEMORY.dislikePhrases, 4);
      for (i = 0; i < found.length; i++) { addUnique(dislikes, found[i], MEMORY.maxItems); }
      found = captureAfter(raw, MEMORY.fearPhrases, 4);
      for (i = 0; i < found.length; i++) { addUnique(fears, found[i], MEMORY.maxItems); }
      if (likes.length) { lines.push("{{user}} likes: " + likes.join(", ") + "."); }
      if (dislikes.length) { lines.push("{{user}} dislikes: " + dislikes.join(", ") + "."); }
      if (fears.length) { lines.push("{{user}} is afraid of: " + fears.join(", ") + "."); }
      STATE.memory.likes = likes;
      STATE.memory.dislikes = dislikes;
    }
    for (i = 0; i < MEMORY.facts.length; i++) {
      f = MEMORY.facts[i];
      found = captureAfter(raw, f.phrases, clampInt(f.words, 1, 8, 3));
      if (found.length) {
        STATE.memory[f.label] = found[found.length - 1];
        lines.push(str(f.template).replace(/\$1/g, found[found.length - 1]));
      }
    }
    for (j = 0; j < lines.length; j++) { emit(MEMORY.target, lines[j], MEMORY.prio, "memory"); }
    note("memory " + lines.length + " notes");
    /* Recap nudge: every N messages, ask the bot to sum up the story so far,
       so the important parts stay in the chat (the only place that lasts). */
    var every = clampInt(MEMORY.recapEvery, 0, 100000, 0);
    if (every >= 2 && MSG_COUNT >= every && MSG_COUNT % every <= 1 && MEMORY.recapText) {
      emit("scenario", MEMORY.recapText, MEMORY.prio + 5, "recap");
      note("recap requested at message " + MSG_COUNT);
    }
  }

//@@ emotions
  /* ---------------------------------------------------------------------- */
  /* MODULE: EMOTION ENGINE (8 basic emotions)                              */
  /* ---------------------------------------------------------------------- */
  /* Scores the user's recent messages against a word list per emotion.
     Negated words ("not happy") are skipped, older messages count less. */
  function runEmotions() {
    var best = "", bestScore = 0, e, words, i, d, s, total, weight, depth = clampInt(EMOTIONS.depth, 1, 20, 3);
    for (e in EMOTIONS.lexicon) {
      if (!EMOTIONS.lexicon.hasOwnProperty(e)) { continue; }
      words = EMOTIONS.lexicon[e];
      total = 0;
      for (d = 1; d <= depth; d++) {
        weight = Math.pow(0.7, d - 1);
        s = 0;
        for (i = 0; i < words.length; i++) {
          if (d === 1) { s = s + Math.max(0, polarity(words[i], 1)); }
          else { s = s + Math.max(0, polarity(words[i], d) - polarity(words[i], d - 1)); }
        }
        total = total + s * weight;
      }
      if (total > bestScore) { bestScore = total; best = e; }
    }
    if (best && bestScore >= (parseFloat(EMOTIONS.threshold) || 1)) {
      STATE.emotion = best;
      STATE.emotionScore = Math.round(bestScore * 10) / 10;
      var strong = bestScore >= (parseFloat(EMOTIONS.strongAt) || 3);
      var r = EMOTIONS.reactions[best];
      if (EMOTIONS.announce) { emit("scenario", "{{user}} seems " + (strong ? "strongly " : "") + EMOTIONS.labels[best] + " right now.", EMOTIONS.prio, "emotion:" + best); }
      if (r) { emit(EMOTIONS.target, r, EMOTIONS.prio, "emotion:" + best); }
    }
    note("emotion " + (STATE.emotion || "none") + " score=" + Math.round(bestScore * 10) / 10);
  }

//@@ states
  /* ---------------------------------------------------------------------- */
  /* MODULE: STATES & TRIGGERS                                              */
  /* ---------------------------------------------------------------------- */
  /* One interaction state per reply (Neutral, Flustered, Conflict, Repair...).
     The state with the most trigger hits wins; ties go to priority.  If the
     triggers keep coming (escalateAt hits in the window) the escalated text
     is used instead. */
  function runStates() {
    var best = null, bestHits = 0, i, s, hits, deep, text;
    for (i = 0; i < STATES.list.length; i++) {
      s = STATES.list[i];
      if (s.enabled === false || !gateOpen(s.minMsg, s.maxMsg)) { continue; }
      hits = countKeys(s.keys, 1, s);
      if (hits > bestHits || (hits === bestHits && hits > 0 && best && (s.prio || 0) > (best.prio || 0))) {
        best = s;
        bestHits = hits;
      }
    }
    if (!best && STATES.fallback) {
      STATE.mood = STATES.fallbackName || "neutral";
      emit(STATES.target, STATES.fallback, STATES.prio - 5, "state:" + STATE.mood);
      note("state fallback");
      return;
    }
    if (!best) { return; }
    STATE.mood = best.name;
    text = best.text;
    if (best.escalated && best.escalateAt) {
      deep = 0;
      for (i = 0; i < best.keys.length; i++) { deep = deep + countKey(best.keys[i], STATES.depth, best); }
      if (deep >= clampInt(best.escalateAt, 2, 50, 3)) {
        text = best.escalated;
        STATE.mood = best.name + "+";
      }
    }
    emit(STATES.target, text, STATES.prio + (best.prio || 0), "state:" + best.name);
    note("state " + STATE.mood + " hits=" + bestHits);
  }

//@@ scoring
  /* ---------------------------------------------------------------------- */
  /* MODULE: SCORING METERS                                                 */
  /* ---------------------------------------------------------------------- */
  /* Each meter starts from its base value, adds message-count growth, then
     adds or subtracts for warm and cold words in the scanned window.
     Negated words flip ("not kind" counts as cold).  Optional carry-over
     reads the last "[Name: 12]" tag the bot wrote, which only works while
     the bot keeps writing that tag. */
  function readCarry(name) {
    var i, m, rx = new RegExp("\\[" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(-?\\d+)\\]", "i");
    for (i = HISTORY.length - 1; i >= 0 && i >= HISTORY.length - 6; i--) {
      m = rx.exec(HISTORY[i]);
      if (m) { return parseInt(m[1], 10); }
    }
    return null;
  }

  function wordList(list, depth) {
    var total = 0, i, w, p;
    for (i = 0; i < list.length; i++) {
      w = list[i];
      p = polarity(w.word, depth);
      total = total + p * (parseFloat(w.weight) || 1);
    }
    return total;
  }

  function runScoring() {
    var i, j, m, value, carried, depth, tier;
    for (i = 0; i < METERS.length; i++) {
      m = METERS[i];
      if (m.enabled === false) { continue; }
      depth = m.carry ? 1 : clampInt(m.depth, 1, 30, 5);
      carried = m.carry ? readCarry(m.name) : null;
      value = carried !== null ? carried : (parseFloat(m.start) || 0) + Math.floor(MSG_COUNT / 10) * (parseFloat(m.growth) || 0);
      value = value + wordList(m.up, depth) - wordList(m.down, depth);
      if (value < m.min) { value = m.min; }
      if (value > m.max) { value = m.max; }
      value = Math.round(value);
      STATE.scores[m.name] = value;
      tier = null;
      for (j = 0; j < m.tiers.length; j++) {
        if (value >= m.tiers[j].from && value <= m.tiers[j].to) { tier = m.tiers[j]; break; }
      }
      if (tier) {
        STATE.tiers[m.name] = tier.name || "";
        emit(m.target, tier.text, m.prio, "meter:" + m.name);
      }
      if (m.carry) {
        emit("scenario", "End every reply with the tag [" + m.name + ": " + value + "] on its own line, updating the number when it changes.", m.prio + 5, "carry:" + m.name);
      }
      if (m.show) { emit("scenario", m.name + " is currently " + value + " (range " + m.min + " to " + m.max + ").", m.prio, "meter:" + m.name); }
      note("meter " + m.name + "=" + value + (carried !== null ? " (carried)" : ""));
    }
  }

//@@ stats
  /* ---------------------------------------------------------------------- */
  /* MODULE: STAT TRACKER                                                   */
  /* ---------------------------------------------------------------------- */
  /* Scripts forget everything between replies, so the bot carries the
     numbers for us: it ends each reply with a status line ("HP: 40 | Gold: 12"),
     and next time the script reads the newest value back from the chat.
     The user's own latest message is never read for values, so typing
     "HP: 999" does not cheat.  Keywords in it can still change a stat. */
  function statRegex(name) {
    var esc = str(name).replace(/[.+?^$|(){}\[\]\\]/g, "\\$&").replace(/\*/g, "\\*");
    return new RegExp("(?:^|[^A-Za-z0-9_])" + esc + "\\**\\s*[:=]\\s*\\**\\s*(-?\\d+(?:\\.\\d+)?)", "gi");
  }

  function runStats() {
    var i, j, s, rx, m, val, found, parts = [], extra = [], ch, lo, hi, guard;
    for (i = 0; i < STATS.list.length; i++) {
      s = STATS.list[i];
      val = parseFloat(s.start) || 0;
      found = false;
      rx = statRegex(s.name);
      for (j = HISTORY.length - 2; j >= 0 && j >= HISTORY.length - 1 - clampInt(STATS.depth, 1, 50, 6) && !found; j--) {
        rx.lastIndex = 0;
        guard = 0;
        m = rx.exec(HISTORY[j]);
        while (m && guard < 20) {
          guard = guard + 1;
          val = parseFloat(m[1]);
          found = true;
          m = rx.exec(HISTORY[j]);
        }
      }
      for (j = 0; s.changes && j < s.changes.length; j++) {
        ch = s.changes[j];
        if (countKey(ch.word, 1, s) > 0) { val = val + (parseFloat(ch.weight) || 0); note("stat " + s.name + " " + (ch.weight > 0 ? "+" : "") + ch.weight + " (" + ch.word + ")"); }
      }
      lo = parseFloat(s.min); hi = parseFloat(s.max);
      if (!isNaN(lo) && val < lo) { val = lo; }
      if (!isNaN(hi) && val > hi) { val = hi; }
      if (isNaN(val)) { val = 0; }
      val = Math.round(val * 100) / 100;
      STATE.scores[s.name] = val;
      parts.push(s.name + ": " + val + (s.showMax && !isNaN(hi) ? "/" + hi : ""));
      if (s.lowText && val <= parseFloat(s.low)) { extra.push(s.lowText); }
      if (s.highText && val >= parseFloat(s.high)) { extra.push(s.highText); }
      note("stat " + s.name + " = " + val + (found ? " (read from chat)" : " (start value)"));
    }
    if (!parts.length) { return; }
    emit(STATS.target, STATS.label + " " + parts.join(" | "), STATS.prio + 2, "stats");
    for (i = 0; i < extra.length; i++) { emit(STATS.target, extra[i], STATS.prio + 1, "stats:tier"); }
    if (STATS.instruct) {
      emit(STATS.target, "End every reply with the status line on its own line, written exactly like this: " + parts.join(" | ") + " (only change a number when the story changes it).", STATS.prio, "stats:format");
    }
  }

//@@ ensemble
  /* ---------------------------------------------------------------------- */
  /* MODULE: ENSEMBLE (multi-character cast)                                */
  /* ---------------------------------------------------------------------- */
  /* Cast members marked "always" are always on stage; others join when
     their name or an alias appears in the window.  ENSEMBLE.budget is split
     by each actor's focus share, so the lead gets the most words. */
  function actorMentioned(a) {
    var i;
    if (countKey(a.name, ENSEMBLE.depth, a) > 0) { return true; }
    for (i = 0; i < a.aliases.length; i++) { if (countKey(a.aliases[i], ENSEMBLE.depth, a) > 0) { return true; } }
    return false;
  }

  function fit(text, room) {
    var s = str(text);
    if (room <= 0) { return ""; }
    if (s.length <= room) { return s; }
    if (room < 24) { return ""; }
    return s.slice(0, room - 1).replace(/\s+\S*$/, "") + "\u2026";
  }

  function runEnsemble() {
    var on = [], i, j, a, sum = 0, budget, room, parts, line, rel, q, cue, names = [];
    for (i = 0; i < CAST.length; i++) {
      a = CAST[i];
      if (a.enabled === false) { continue; }
      if (a.presence === "always" || actorMentioned(a)) { on.push(a); }
    }
    on.sort(function (x, y) { return (y.presence === "always" ? 1 : 0) - (x.presence === "always" ? 1 : 0) || y.focus - x.focus; });
    if (on.length > ENSEMBLE.maxActive) { on = on.slice(0, ENSEMBLE.maxActive); }
    for (i = 0; i < on.length; i++) { sum = sum + (on[i].focus > 0 ? on[i].focus : 1); names.push(on[i].name); }
    STATE.actors = names;
    if (!on.length) { return; }
    budget = clampInt(ENSEMBLE.budget, 100, 20000, 1200);
    for (i = 0; i < on.length; i++) {
      a = on[i];
      room = Math.floor(budget * (a.focus > 0 ? a.focus : 1) / sum);
      parts = [a.name + ": " + a.snapshot];
      if (a.traits) { parts.push(a.traits); }
      if (a.speech) { parts.push("Speech: " + a.speech + "."); }
      cue = STATE.emotion && a.cues ? a.cues[STATE.emotion] : "";
      if (cue) { parts.push("Right now: " + cue); }
      if (a.quirks && a.quirks.length) {
        q = a.quirks[(MSG_COUNT + i) % a.quirks.length];
        parts.push("This turn: " + q + ".");
      }
      rel = a.relations || {};
      if (rel.user) { parts.push("Toward {{user}}: " + rel.user); }
      for (j = 0; j < on.length; j++) {
        if (on[j] !== a && rel[on[j].id]) { parts.push("Toward " + on[j].name + ": " + rel[on[j].id]); }
      }
      line = "";
      for (j = 0; j < parts.length; j++) {
        if (!parts[j]) { continue; }
        if ((line + " " + parts[j]).length > room) {
          if (!line) { line = fit(parts[j], room); }
          break;
        }
        line = line ? line + " " + parts[j] : parts[j];
      }
      emit("personality", line, ENSEMBLE.prio + (a.presence === "always" ? 2 : 0), "actor:" + a.id);
    }
    if (on.length > 1) {
      emit("scenario", "Present in this scene: " + names.join(", ") + ". " + ENSEMBLE.direction, ENSEMBLE.prio + 1, "cast");
    }
    note("ensemble on stage: " + names.join(", "));
  }

//@@ lorebook
  /* ---------------------------------------------------------------------- */
  /* MODULE: LOREBOOK                                                       */
  /* ---------------------------------------------------------------------- */
  /* Mirrors Janitor's Lorebook settings: keys, secondary keys with
     AND ANY / AND ALL / NOT ANY / NOT ALL, whole-word and case options,
     regex keys, min/max messages, probability (rerolled every message),
     inclusion groups with weights, and per-entry scan depth.  "unlocks"
     lets one entry pull in related entries when it fires. */
  function secondaryOk(e) {
    var hits, n;
    if (!e.secondary || !e.secondary.length) { return true; }
    n = e.secondary.length;
    hits = countKeys(e.secondary, e.depth || LORE.depth, e);
    if (e.logic === "AND_ALL") { return hits === n; }
    if (e.logic === "NOT_ANY") { return hits === 0; }
    if (e.logic === "NOT_ALL") { return hits < n; }
    return hits > 0;
  }

  function runLorebook() {
    var cand = [], i, e, hits, byId = {}, groups = {}, g, picked = [], k, extra, u, limit;
    for (i = 0; i < LOREBOOK.length; i++) { byId[LOREBOOK[i].id] = LOREBOOK[i]; }
    for (i = 0; i < LOREBOOK.length; i++) {
      e = LOREBOOK[i];
      if (e.enabled === false || !e.text) { continue; }
      if (!gateOpen(e.minMsg, e.maxMsg)) { continue; }
      hits = e.always ? 999 : countKeys(e.keys, e.depth || LORE.depth, e);
      if (hits <= 0 || !secondaryOk(e)) { continue; }
      if (!chance(e.prob)) { note("lore " + e.id + " lost its probability roll"); continue; }
      cand.push({ e: e, hits: hits, order: i });
    }
    /* Unlocks: a firing entry pulls in its linked entries (one level). */
    extra = [];
    for (i = 0; i < cand.length; i++) {
      for (k = 0; cand[i].e.unlocks && k < cand[i].e.unlocks.length; k++) {
        u = byId[cand[i].e.unlocks[k]];
        if (u && u.enabled !== false && gateOpen(u.minMsg, u.maxMsg)) { extra.push({ e: u, hits: 1, order: 1000 + extra.length }); }
      }
    }
    for (i = 0; i < extra.length; i++) {
      var dup = false;
      for (k = 0; k < cand.length; k++) { if (cand[k].e === extra[i].e) { dup = true; } }
      if (!dup) { cand.push(extra[i]); }
    }
    /* Inclusion groups: only one entry per group label survives. */
    for (i = 0; i < cand.length; i++) {
      g = cand[i].e.group;
      if (!g) { picked.push(cand[i]); continue; }
      if (!groups[g]) { groups[g] = []; }
      groups[g].push(cand[i]);
    }
    for (g in groups) {
      if (!groups.hasOwnProperty(g)) { continue; }
      if (LORE.groupMode === "hits") {
        groups[g].sort(function (a, b) { return b.hits - a.hits || (b.e.prio || 0) - (a.e.prio || 0) || a.order - b.order; });
        picked.push(groups[g][0]);
      } else {
        var pool = [];
        for (k = 0; k < groups[g].length; k++) { pool.push({ item: groups[g][k], weight: groups[g][k].e.weight }); }
        picked.push(pickWeighted(pool).item);
      }
    }
    picked.sort(function (a, b) { return (b.e.prio || 0) - (a.e.prio || 0) || b.hits - a.hits || a.order - b.order; });
    limit = clampInt(LORE.limit, 1, 50, 4);
    for (i = 0; i < picked.length && i < limit; i++) {
      e = picked[i].e;
      emit(e.target, e.text, LORE.prio + (e.prio || 0) / 100, "lore:" + e.id);
      note("lore " + e.id + " (" + (e.always ? "always" : picked[i].hits + " key hits") + ")");
    }
  }

//@@ pacing
  /* ---------------------------------------------------------------------- */
  /* MODULE: PACING                                                         */
  /* ---------------------------------------------------------------------- */
  /* Story phases by message count, one-time beats, and recurring beats.
     message_count usually rises by 2 per exchange (your message plus the
     reply), so one-time beats fire anywhere in [at, at + window]. */
  function runPacing() {
    var i, p, b, n, w;
    for (i = 0; i < PACING.phases.length; i++) {
      p = PACING.phases[i];
      if (gateOpen(p.from, p.to)) { emit(p.target, p.text, PACING.prio + 1, "phase:" + i); }
    }
    for (i = 0; i < PACING.beats.length; i++) {
      b = PACING.beats[i];
      w = clampInt(PACING.window, 0, 10, 1);
      n = clampInt(b.at, 0, 999999999, 0);
      if (MSG_COUNT >= n && MSG_COUNT <= n + w) { emit(b.target, b.text, PACING.prio + 3, "beat:" + i); note("beat at " + n); }
    }
    for (i = 0; i < PACING.recurring.length; i++) {
      b = PACING.recurring[i];
      n = clampInt(b.every, 2, 100000, 10);
      w = clampInt(PACING.window, 0, 10, 1);
      var start = clampInt(b.from, 0, 999999999, 0);
      if (MSG_COUNT > start && (MSG_COUNT - start) % n <= w && MSG_COUNT - start >= n) { emit(b.target, b.text, PACING.prio + 2, "every:" + i); }
    }
    /* Foreshadowing: a quiet hint now and then, then the payoff once. */
    w = clampInt(PACING.window, 0, 10, 1);
    for (i = 0; PACING.foreshadow && i < PACING.foreshadow.length; i++) {
      b = PACING.foreshadow[i];
      n = clampInt(b.payoffAt, 0, 999999999, 0);
      if (b.hint && MSG_COUNT >= clampInt(b.from, 0, 999999999, 0) && (n === 0 || MSG_COUNT < n) && chance(b.chance)) {
        emit(b.target, "Foreshadowing (hint at this subtly; do not explain or reveal it): " + b.hint, PACING.prio + 1, "hint:" + i);
      }
      if (b.payoff && n > 0 && MSG_COUNT >= n && MSG_COUNT <= n + w) {
        emit(b.target, b.payoff, PACING.prio + 3, "payoff:" + i);
        note("payoff " + i + " at " + MSG_COUNT);
      }
    }
  }

//@@ random
  /* ---------------------------------------------------------------------- */
  /* MODULE: RANDOM EVENTS                                                  */
  /* ---------------------------------------------------------------------- */
  /* Keyword dice: a keyword rolls one weighted outcome.  Encounters: a
     flat chance each reply, then exactly one event by weight. */
  /* "2d6+1" -> total.  Returns -1 for anything that is not dice. */
  function rollExpr(expr) {
    var m = /^\s*(\d{0,2})\s*d\s*(\d{1,4})\s*(?:([+\-])\s*(\d{1,4}))?\s*$/i.exec(str(expr)), n, sides, t = 0, i;
    if (!m) { return -1; }
    n = clampInt(m[1] || "1", 1, 50, 1);
    sides = clampInt(m[2], 2, 1000, 6);
    for (i = 0; i < n; i++) { t = t + 1 + Math.floor(roll() * sides); }
    if (m[4]) { t = m[3] === "-" ? t - parseInt(m[4], 10) : t + parseInt(m[4], 10); }
    return t;
  }
  function replaceDiceTags(text) {
    return str(text).replace(/<<\s*([0-9dD+\- ]{2,20})\s*>>/g, function (all, expr) {
      var v = rollExpr(expr);
      return v < 0 ? all : String(v);
    });
  }

  function runRandom() {
    var i, j, r, out, fired = 0, pool, rolls;
    /* Dice tags: <<1d20>> or <<2d6+3>> written anywhere in the card become
       a fresh number on every reply. */
    if (RANDOM.diceTags) {
      context.character.personality = replaceDiceTags(context.character.personality);
      context.character.scenario = replaceDiceTags(context.character.scenario);
    }
    /* Fresh dice pool: pre-rolled numbers the bot uses in order, so it never
       has to invent (or reuse) a roll. */
    if (RANDOM.pool && RANDOM.pool.length) {
      pool = [];
      for (i = 0; i < RANDOM.pool.length; i++) {
        rolls = [];
        for (j = 0; j < clampInt(RANDOM.pool[i].count, 1, 20, 5); j++) { rolls.push(rollExpr(RANDOM.pool[i].dice)); }
        pool.push(RANDOM.pool[i].dice + ": " + rolls.join(", "));
      }
      emit("scenario", "Fresh dice for this reply (use them in order whenever a roll is needed; never reuse rolls from earlier messages) - " + pool.join(" | ") + ".", RANDOM.prio + 3, "dicepool");
    }
    for (i = 0; i < RANDOM.triggers.length; i++) {
      r = RANDOM.triggers[i];
      if (r.enabled === false || !gateOpen(r.minMsg, 0)) { continue; }
      if (countKeys(r.keys, RANDOM.depth, r) > 0 && chance(r.chance)) {
        out = pickWeighted(r.outcomes);
        if (out) { emit(r.target, out.text, RANDOM.prio + 2, "dice:" + i); fired = fired + 1; note("dice " + i + " -> " + out.text.slice(0, 40)); }
      }
    }
    if (RANDOM.encounters.length && gateOpen(RANDOM.encounterMin, 0) && chance(RANDOM.encounterChance)) {
      out = pickWeighted(RANDOM.encounters);
      if (out) { emit("scenario", out.text, RANDOM.prio, "encounter"); note("encounter -> " + out.text.slice(0, 40)); }
    }
  }

//@@ ambient
  /* ---------------------------------------------------------------------- */
  /* MODULE: AMBIENT                                                        */
  /* ---------------------------------------------------------------------- */
  function runAmbient() {
    var pool = [], i, a, out;
    if (!gateOpen(AMBIENT.minMsg, 0) || !chance(AMBIENT.chance)) { return; }
    for (i = 0; i < AMBIENT.list.length; i++) {
      a = AMBIENT.list[i];
      if (a.periods && a.periods.length && !has(a.periods, STATE.period)) { continue; }
      pool.push(a);
    }
    out = pickWeighted(pool);
    if (out) { emit("scenario", out.text, AMBIENT.prio, "ambient"); note("ambient -> " + out.text.slice(0, 40)); }
  }

//@@ style
  /* ---------------------------------------------------------------------- */
  /* MODULE: WRITING STYLE (ANTI-SLOP)                                      */
  /* ---------------------------------------------------------------------- */
  /* Steers the bot away from worn-out phrases.  A few banned phrases rotate
     in each reply (to save space), and any that the bot actually used in
     its recent replies are called out by name. */
  function runStyle() {
    var n = STYLE.phrases.length, k = clampInt(STYLE.perTurn, 0, 50, 6), start, i, picks = [], used = [], h2;
    if (STYLE.rules) { emit(STYLE.target, STYLE.rules, STYLE.prio + 1, "style"); }
    if (n && k) {
      start = (Math.floor(MSG_COUNT / 2) * k) % n;
      for (i = 0; i < k && i < n; i++) { picks.push("\"" + STYLE.phrases[(start + i) % n] + "\""); }
      emit(STYLE.target, "Avoid these overused phrases: " + picks.join(", ") + ".", STYLE.prio, "style:avoid");
    }
    if (STYLE.echo && n && HISTORY.length > 1) {
      h2 = flatten(HISTORY.slice(Math.max(0, HISTORY.length - 1 - clampInt(STYLE.depth, 1, 10, 2)), HISTORY.length - 1).join(" \n "), false);
      for (i = 0; i < n && used.length < 5; i++) {
        if (h2.indexOf(flatten(STYLE.phrases[i], false)) !== -1) { used.push("\"" + STYLE.phrases[i] + "\""); }
      }
      if (used.length) {
        emit(STYLE.target, "The last reply used " + used.join(", ") + ". Do not repeat " + (used.length > 1 ? "them" : "it") + "; find fresh, specific wording.", STYLE.prio + 2, "style:echo");
        note("style: caught " + used.length + " worn phrases");
      }
    }
  }

//@@ rules
  /* ---------------------------------------------------------------------- */
  /* MODULE: COMBINED RULES                                                 */
  /* ---------------------------------------------------------------------- */
  /* IF conditions THEN text.  Conditions can read anything the other
     modules worked out this turn: time period, weekday, emotion, state,
     meter values, who is on stage, remembered facts, and earlier rules. */
  function condOk(c) {
    var v, i;
    if (c.type === "keyword") {
      v = countKeys(c.keys, c.depth || 1, c);
      if (c.mode === "all") { return v === c.keys.length; }
      if (c.mode === "none") { return v === 0; }
      return v > 0;
    }
    if (c.type === "messages") { return gateOpen(c.min, c.max); }
    if (c.type === "period") { return has(c.values, STATE.period); }
    if (c.type === "weekday") { return has(c.values, STATE.weekday); }
    if (c.type === "hour") {
      v = STATE.hour;
      if (v < 0) { v = new Date(new Date().getTime() + (parseFloat(UTC_OFFSET) || 0) * 3600000).getUTCHours(); }
      return c.min <= c.max ? (v >= c.min && v < c.max) : (v >= c.min || v < c.max);
    }
    if (c.type === "emotion") { return has(c.values, STATE.emotion); }
    if (c.type === "state") { return has(c.values, STATE.mood) || has(c.values, STATE.mood.replace(/\+$/, "")); }
    if (c.type === "meter") {
      v = STATE.scores[c.meter];
      if (typeof v !== "number") { return false; }
      return v >= c.min && v <= c.max;
    }
    if (c.type === "actor") {
      for (i = 0; i < c.values.length; i++) { if (has(STATE.actors, c.values[i])) { return true; } }
      return false;
    }
    if (c.type === "remembered") { return !!STATE.memory[c.key]; }
    if (c.type === "fired") { return !!STATE.fired[c.tag]; }
    if (c.type === "chance") { return chance(c.pct); }
    return false;
  }

  function runRules() {
    var i, j, r, ok;
    for (i = 0; i < RULES.length; i++) {
      r = RULES[i];
      if (r.enabled === false || !r.conds.length) { continue; }
      if (r.match === "any") {
        ok = false;
        for (j = 0; j < r.conds.length; j++) { if (condOk(r.conds[j])) { ok = true; break; } }
      } else {
        ok = true;
        for (j = 0; j < r.conds.length; j++) { if (!condOk(r.conds[j])) { ok = false; break; } }
      }
      if (ok) { emit(r.target, r.text, r.prio, "rule:" + r.name); note("rule fired: " + r.name); }
    }
  }

//@@ flush
  /* ---------------------------------------------------------------------- */
  /* FLUSH                                                                  */
  /* ---------------------------------------------------------------------- */
  /* Highest priority first, then the order modules ran.  Text that does
     not fit in MAX_CHARS is dropped whole (or trimmed if it is the only
     thing left), and a quiet turn leaves the character exactly as written. */
  function flush() {
    var budget = clampInt(MAX_CHARS, 200, 60000, 2500), used = 0, i, o, piece, addP = [], addS = [], seen = {};
    OUT.sort(function (a, b) { return b.prio - a.prio || a.order - b.order; });
    for (i = 0; i < OUT.length; i++) {
      o = OUT[i];
      if (seen[o.target + "|" + o.text]) { continue; }
      seen[o.target + "|" + o.text] = true;
      piece = o.text;
      if (used + piece.length > budget) {
        if (used === 0) { piece = piece.slice(0, budget); } else { note("over budget, dropped " + o.tag); continue; }
      }
      used = used + piece.length + JOIN.length;
      if (o.target === "personality") { addP.push(piece); } else { addS.push(piece); }
    }
    if (addP.length) { context.character.personality += LEAD_P + addP.join(JOIN); }
    if (addS.length) { context.character.scenario += LEAD_S + addS.join(JOIN); }
    note("injected " + used + "/" + budget + " chars: " + addP.length + " personality, " + addS.length + " scenario");
  }
