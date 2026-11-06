/* ======================================================================== */
/* ALL-IN-ONE JANITOR AI SCRIPT                                             */
/* ======================================================================== */
/*
   Paste this whole file into a Janitor AI "Advanced" script, then assign the
   script to your character.  No API, no internet, no outside code.

   ES5 only (var, function, + strings).  Do not add let/const, arrow
   functions or `template strings`: unsupported syntax makes Janitor skip the
   script without any error.

   HOW TO EDIT
     Only touch the blocks marked  >>> EDIT <<< .  Every list is optional:
     empty it (leave the [] brackets) and that module simply does nothing.
     {{char}} and {{user}} are replaced by Janitor with the real names.

   MODULES (in the order they run)
     1. Lorebook   keyword  -> world detail
     2. Memory     "my name is ..." / "I love ..." / "I hate ..." this message
     3. Pacing     story phase by message count + one-time events
     4. Tone       keyword  -> mood/state of {{char}}
     5. Time       real clock hour -> morning/day/evening/night behaviour
     6. Ambient    small random chance of atmosphere text
     7. Random     keyword  -> dice roll picks one reaction
     8. Combined   keyword AND message range AND time of day
     9. Scoring    warm/cold words in this message -> attitude shift

   IMPORTANT: scripts are stateless.  Nothing is remembered between messages
   except the message count, so "memory" and "scoring" only react to the
   current message.

   TESTING: Test Chat -> Show Debug Panel -> Changes tab shows what was added.
   Set DEBUG = 1 to also print what fired.
*/

/* ======================================================================== */
/* GLOBAL KNOBS  >>> EDIT <<<                                               */
/* ======================================================================== */
var DEBUG = 0;            /* 1 = log what fired to the debug panel           */
var MAX_CHARS = 2500;     /* most characters added per reply (token budget)  */
var LORE_LIMIT = 3;       /* most lorebook entries per reply                 */
var UTC_OFFSET = 0;       /* Janitor's clock is UTC. -5 = US Eastern (EST),  */
                          /* -8 = US Pacific, 1 = Central Europe, etc.       */

/* ======================================================================== */
/* 1. LOREBOOK  >>> EDIT <<<                                                */
/* ======================================================================== */
/* keys: lowercase words/phrases, matched as whole words.
   target: "scenario" or "personality".  minMsg: 0 = from the start.        */
var LOREBOOK = [
  { keys: ["tavern", "inn", "bar"], target: "scenario", minMsg: 0,
    text: "The Rusty Lantern tavern is warm, loud and smells of ale and woodsmoke." },
  { keys: ["sword", "blade", "weapon"], target: "scenario", minMsg: 0,
    text: "{{char}} carries an old family sword with a chipped silver hilt." },
  { keys: ["past", "family", "childhood"], target: "personality", minMsg: 20,
    text: "{{char}} grew up poor and rarely talks about family, but opens up a little to people they trust." }
];

/* ======================================================================== */
/* 2. MEMORY  >>> EDIT <<<                                                  */
/* ======================================================================== */
var MEMORY_ON = true;     /* false turns off name/likes/dislikes detection   */

/* ======================================================================== */
/* 3. PACING  >>> EDIT <<<                                                  */
/* ======================================================================== */
/* from/to: message count range (to: 0 = no end).  First match wins.        */
var PHASES = [
  { from: 0,  to: 30,  target: "personality",
    text: "{{char}} is guarded and polite with {{user}}, still a near-stranger." },
  { from: 31, to: 80,  target: "personality",
    text: "{{char}} is comfortable around {{user}}, teasing them and sharing small secrets." },
  { from: 81, to: 0,   target: "personality",
    text: "{{char}} trusts {{user}} completely and shows it openly." }
];
/* Fires on exactly one message count. */
var ONE_TIME_EVENTS = [
  { at: 15, text: "Event: a stranger in a dark cloak bumps into {{user}} and slips away without a word." },
  { at: 50, text: "Event: a storm rolls in and the roads close; everyone is stuck indoors tonight." }
];

/* ======================================================================== */
/* 4. TONE  >>> EDIT <<<                                                    */
/* ======================================================================== */
/* First matching row wins, so put the most important moods first.          */
var TONES = [
  { keys: ["sad", "crying", "lonely", "hurt"],
    text: "{{char}} notices {{user}} is upset and becomes gentle and comforting." },
  { keys: ["fight", "attack", "threat", "kill"],
    text: "{{char}} becomes alert, serious and protective." },
  { keys: ["joke", "funny", "laugh", "lol"],
    text: "{{char}} is playful and quick to laugh." }
];

/* ======================================================================== */
/* 5. TIME OF DAY  >>> EDIT <<<                                             */
/* ======================================================================== */
/* Hours 0-23 in your time zone (see UTC_OFFSET).  A range may wrap midnight. */
var TIME_SLOTS = [
  { from: 5,  to: 11, text: "It is morning; {{char}} is fresh and energetic." },
  { from: 12, to: 17, text: "It is afternoon; {{char}} is busy with the day's work." },
  { from: 18, to: 22, text: "It is evening; {{char}} is relaxed and talkative." },
  { from: 23, to: 4,  text: "It is late at night; {{char}} is sleepy and speaks softly." }
];

/* ======================================================================== */
/* 6. AMBIENT  >>> EDIT <<<                                                 */
/* ======================================================================== */
var AMBIENT_CHANCE = 10;  /* percent chance per reply that one line is added */
var AMBIENT = [
  "A floorboard creaks somewhere nearby.",
  "Wind rattles the shutters.",
  "Somewhere outside, a dog barks twice and falls silent."
];

/* ======================================================================== */
/* 7. RANDOM EVENTS  >>> EDIT <<<                                           */
/* ======================================================================== */
/* When a key is said, one outcome is picked; weight = how likely.          */
var RANDOM_EVENTS = [
  { keys: ["dice", "gamble", "bet"],
    outcomes: [
      { weight: 50, text: "{{user}} wins the bet; {{char}} grumbles and pays up." },
      { weight: 40, text: "{{user}} loses the bet; {{char}} grins and collects." },
      { weight: 10, text: "The dice land on edge; everyone stares in disbelief." }
    ] },
  { keys: ["attack", "swing", "strike"],
    outcomes: [
      { weight: 70, text: "The attack lands cleanly." },
      { weight: 25, text: "The attack misses." },
      { weight: 5,  text: "Critical hit: the attack lands devastatingly well." }
    ] }
];

/* ======================================================================== */
/* 8. COMBINED CONDITIONS  >>> EDIT <<<                                     */
/* ======================================================================== */
/* All set conditions must be true.  keys: [] = any message.
   minMsg/maxMsg: 0 = no limit.  hourFrom/hourTo: -1 = any time.            */
var COMBINED = [
  { keys: ["kiss", "hold", "close"], minMsg: 60, maxMsg: 0, hourFrom: 18, hourTo: 4,
    text: "The late hour and their long history make {{char}} unusually bold and affectionate." },
  { keys: ["secret"], minMsg: 0, maxMsg: 20, hourFrom: -1, hourTo: -1,
    text: "{{char}} does not know {{user}} well enough yet to share secrets and changes the subject." }
];

/* ======================================================================== */
/* 9. SCORING  >>> EDIT <<<                                                 */
/* ======================================================================== */
var WARM_WORDS = ["thank", "thanks", "love", "sorry", "please", "beautiful", "kind", "hug"];
var COLD_WORDS = ["hate", "stupid", "shut up", "idiot", "ugly", "leave me alone"];
var SCORE_RULES = [
  { min: 2,  text: "{{user}} is being very kind; {{char}} warms up noticeably." },
  { max: -2, text: "{{user}} is being hostile; {{char}} turns cold and defensive." }
];

/* ======================================================================== */
/* ENGINE - no need to edit below this line                                 */
/* ======================================================================== */
if (!context.character) { context.character = {}; }
if (!context.chat) { context.chat = {}; }
if (typeof context.character.personality !== "string") { context.character.personality = ""; }
if (typeof context.character.scenario !== "string") { context.character.scenario = ""; }

(function () {
  try {
    var RAW = context.chat.last_message;
    if (typeof RAW !== "string") { RAW = ""; }
    var HAY = " " + RAW.toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ") + " ";
    var COUNT = parseInt(context.chat.message_count, 10);
    if (isNaN(COUNT) || COUNT < 0) { COUNT = 0; }
    var HOUR = (new Date().getUTCHours() + UTC_OFFSET + 48) % 24;

    var addP = [];
    var addS = [];
    var used = 0;

    var log = function (s) { if (DEBUG) { console.log("[script] " + s); } };

    var add = function (target, text) {
      if (!text) { return; }
      var t = String(text);
      if (used + t.length > MAX_CHARS) { log("budget full, skipped: " + t.slice(0, 40)); return; }
      used += t.length;
      if (target === "personality") { addP.push(t); } else { addS.push(t); }
    };

    var hit = function (key) {
      var k = " " + String(key).toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ") + " ";
      return k !== "  " && HAY.indexOf(k) !== -1;
    };

    var anyHit = function (keys) {
      if (!keys || !keys.length) { return false; }
      for (var i = 0; i < keys.length; i++) { if (hit(keys[i])) { return true; } }
      return false;
    };

    var inHours = function (from, to) {
      if (from < 0 || to < 0) { return true; }
      if (from <= to) { return HOUR >= from && HOUR <= to; }
      return HOUR >= from || HOUR <= to;
    };

    var inCount = function (min, max) {
      if (min > 0 && COUNT < min) { return false; }
      if (max > 0 && COUNT > max) { return false; }
      return true;
    };

    var i, j, e;

    /* 1. Lorebook */
    var loreCount = 0;
    for (i = 0; i < LOREBOOK.length && loreCount < LORE_LIMIT; i++) {
      e = LOREBOOK[i];
      if (inCount(e.minMsg || 0, 0) && anyHit(e.keys)) {
        add(e.target === "personality" ? "personality" : "scenario", e.text);
        loreCount++;
        log("lore: " + e.keys[0]);
      }
    }

    /* 2. Memory (this message only) */
    if (MEMORY_ON && RAW) {
      var m = RAW.match(/\b(?:[Mm]y name is|[Cc]all me|[Ii]['\u2019]?m|[Ii] am)\s+([A-Z][a-zA-Z\-]{1,20})\b/);
      if (m) {
        add("scenario", "{{user}} has said their name is " + m[1] + "; {{char}} remembers and uses it.");
        log("memory name: " + m[1]);
      }
      var like = RAW.match(/\bi (?:really )?(?:love|like|enjoy|adore)\s+([^.!?,]{2,40})/i);
      if (like) { add("scenario", "{{user}} likes " + like[1] + "; {{char}} takes note of it."); }
      var dislike = RAW.match(/\bi (?:really )?(?:hate|dislike|can['\u2019]?t stand|cannot stand)\s+([^.!?,]{2,40})/i);
      if (dislike) { add("scenario", "{{user}} dislikes " + dislike[1] + "; {{char}} avoids it."); }
    }

    /* 3. Pacing */
    for (i = 0; i < PHASES.length; i++) {
      e = PHASES[i];
      if (inCount(e.from, e.to)) { add(e.target, e.text); log("phase " + i); break; }
    }
    for (i = 0; i < ONE_TIME_EVENTS.length; i++) {
      if (ONE_TIME_EVENTS[i].at === COUNT) { add("scenario", ONE_TIME_EVENTS[i].text); log("event at " + COUNT); }
    }

    /* 4. Tone */
    for (i = 0; i < TONES.length; i++) {
      if (anyHit(TONES[i].keys)) { add("personality", TONES[i].text); log("tone " + i); break; }
    }

    /* 5. Time of day */
    for (i = 0; i < TIME_SLOTS.length; i++) {
      if (inHours(TIME_SLOTS[i].from, TIME_SLOTS[i].to)) { add("scenario", TIME_SLOTS[i].text); log("hour " + HOUR); break; }
    }

    /* 6. Ambient */
    if (AMBIENT.length && Math.random() * 100 < AMBIENT_CHANCE) {
      add("scenario", AMBIENT[Math.floor(Math.random() * AMBIENT.length)]);
      log("ambient");
    }

    /* 7. Random events */
    for (i = 0; i < RANDOM_EVENTS.length; i++) {
      e = RANDOM_EVENTS[i];
      if (!anyHit(e.keys) || !e.outcomes || !e.outcomes.length) { continue; }
      var total = 0;
      for (j = 0; j < e.outcomes.length; j++) { total += (e.outcomes[j].weight > 0 ? e.outcomes[j].weight : 0); }
      var roll = Math.random() * total;
      for (j = 0; j < e.outcomes.length; j++) {
        roll -= (e.outcomes[j].weight > 0 ? e.outcomes[j].weight : 0);
        if (roll < 0) { add("scenario", e.outcomes[j].text); log("random " + i + " -> " + j); break; }
      }
    }

    /* 8. Combined conditions */
    for (i = 0; i < COMBINED.length; i++) {
      e = COMBINED[i];
      var keyOk = (!e.keys || !e.keys.length) ? true : anyHit(e.keys);
      if (keyOk && inCount(e.minMsg || 0, e.maxMsg || 0) &&
          inHours(typeof e.hourFrom === "number" ? e.hourFrom : -1, typeof e.hourTo === "number" ? e.hourTo : -1)) {
        add("scenario", e.text);
        log("combined " + i);
      }
    }

    /* 9. Scoring (this message only) */
    var score = 0;
    for (i = 0; i < WARM_WORDS.length; i++) { if (hit(WARM_WORDS[i])) { score++; } }
    for (i = 0; i < COLD_WORDS.length; i++) { if (hit(COLD_WORDS[i])) { score--; } }
    for (i = 0; i < SCORE_RULES.length; i++) {
      e = SCORE_RULES[i];
      if ((typeof e.min === "number" && score >= e.min) || (typeof e.max === "number" && score <= e.max)) {
        add("personality", e.text);
        log("score " + score);
        break;
      }
    }

    /* Flush: append only, never overwrite the character's own text */
    if (addP.length) { context.character.personality += "\n\n" + addP.join("\n"); }
    if (addS.length) { context.character.scenario += "\n\n" + addS.join("\n"); }
    log("count " + COUNT + ", hour " + HOUR + ", added " + used + " chars");
  } catch (err) {
    console.log("[script] error: " + err);
  }
})();
