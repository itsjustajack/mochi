/* ======================================================================== */
/* HEADER                                                                   */
/* ======================================================================== */
/*
   Deep Tactical Research Agent (Janitor AI Advanced script, version 3.3)

   A deep research agent for tactical analysis, military history, weapon
   systems, martial arts and combat mechanics.  It clarifies the question,
   splits it into angles, researches with source checks, and writes one
   cited report that opens with a bottom-line paragraph.

   ES5 only: var, function expressions, string concatenation.  No let,
   const, arrow functions or template strings.  Unsupported syntax stops a
   Janitor script with no error message.

   HOW THE USER DRIVES IT (each message is read fresh; Janitor scripts keep
   no memory between messages, so the stage comes from the newest message)
     new question        -> plan, angles and clarifying questions, then
                            "say go to start"            (when PLAN_FIRST = 1)
     "go"                -> researches the plan in the previous reply and
                            writes the report
     "quick" / "briefly" -> skips the plan and answers directly
     "go deeper on angle 2", "compare ...", "verify ..." -> follow-up
     "show notes"        -> per-angle notes behind the last report

   TOOLS.  A Janitor script cannot browse.  An always-on rule tells the
   model to use any web tools it has, otherwise to work from sources the
   user pastes or from well-known published references, and to say which.

   DEBUG: set DEBUG to 1, then Test Chat > Show Debug Panel > Changes tab.
*/

/* ======================================================================== */
/* GLOBAL KNOBS                                                             */
/* ======================================================================== */
var DEBUG = 0;            /* 1 prints the selection to the debug panel     */
var PLAN_FIRST = 1;       /* 1 = plan, wait for go, then report; 0 = direct */
var NOTES_FIRST = 1;      /* 1 = tactical notes before the report          */
var APPLY_LIMIT = 6;      /* most topic entries injected in one turn       */
var MAX_CHARS = 5000;     /* most characters injected in one turn          */
var WINDOW_DEPTH = 3;     /* messages scanned for topic keys               */
var JOIN = "\n\n";        /* separator between injected pieces             */

/* Phrases that skip the plan stage.  Matched as whole words or phrases
   against the newest message only, so "f1" no longer fires inside "f150"
   and "expand" no longer fires inside "expanded". */
var SKIP_PLAN_KEYS = ["quick", "quickly", "briefly", "tldr", "tl dr", "no plan",
  "skip the plan", "just answer", "short answer", "in short"];

/* Phrases that mean "follow up on the last report". */
var FOLLOW_UP_KEYS = ["go deeper", "dig into", "tell me more", "more detail",
  "elaborate on", "expand on", "continue", "part 2", "compare", "verify",
  "fact check", "angle 1", "angle 2", "angle 3", "angle 4", "angle 5", "angle 6"];

/* Whole-message commands. */
var GO_KEYS = ["go", "go ahead", "start", "begin", "proceed", "yes go", "ok go", "do it"];
var NOTES_KEYS = ["show notes", "show the notes", "notes please", "see notes"];

/* Short replies that are not a new question: inject the rules only. */
var ACK_KEYS = ["ok", "okay", "thanks", "thank you", "thx", "cool", "nice", "got it", "great"];

/* ======================================================================== */
/* OUTPUT GUARDS                                                            */
/* ======================================================================== */
if (typeof context === "undefined" || !context) { context = {}; }
if (!context.character) { context.character = {}; }
if (!context.chat) { context.chat = {}; }
if (typeof context.character.personality !== "string") { context.character.personality = ""; }
if (typeof context.character.scenario !== "string") { context.character.scenario = ""; }

(function () {
  try {

    /* ==================================================================== */
    /* INPUT NORMALIZATION                                                  */
    /* ==================================================================== */
    function clampInt(value, low, high, fallback) {
      var n = parseInt(value, 10);
      if (isNaN(n)) { return fallback; }
      if (n < low) { return low; }
      if (n > high) { return high; }
      return n;
    }

    function flatten(text) {
      return " " + String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    }

    var LAST = context.chat.last_message;
    if (typeof LAST !== "string") { LAST = ""; }
    var LAST_FLAT = flatten(LAST);
    var LAST_TRIM = LAST_FLAT.replace(/^ +| +$/g, "");
    var MSG_COUNT = clampInt(context.chat.message_count, 0, 999999999, 0);

    function buildWindow() {
      var out = [];
      var list = context.chat.last_messages;
      var depth = clampInt(WINDOW_DEPTH, 1, 20, 3);
      var i, item, text, start;
      if (list && typeof list.length === "number") {
        start = list.length - depth;
        if (start < 0) { start = 0; }
        for (i = start; i < list.length; i++) {
          item = list[i];
          text = "";
          if (typeof item === "string") { text = item; }
          else if (item && typeof item.message === "string") { text = item.message; }
          if (text) { out.push(text); }
        }
      }
      if (!out.length && LAST) { out.push(LAST); }
      return out.join(" \n ");
    }

    var HAY = flatten(buildWindow());

    /* ==================================================================== */
    /* UTILITIES                                                            */
    /* ==================================================================== */
    function hasKey(hay, key) {
      var needle = flatten(key);
      if (needle === "  ") { return false; }
      return hay.indexOf(needle) !== -1;
    }

    function anyKey(hay, keys) {
      var i;
      for (i = 0; i < keys.length; i++) {
        if (hasKey(hay, keys[i])) { return true; }
      }
      return false;
    }

    function countHits(hay, keys) {
      var i, n = 0;
      for (i = 0; i < keys.length; i++) {
        if (hasKey(hay, keys[i])) { n++; }
      }
      return n;
    }

    function isExactly(keys) {
      var i;
      for (i = 0; i < keys.length; i++) {
        if (LAST_TRIM === flatten(keys[i]).replace(/^ +| +$/g, "")) { return true; }
      }
      return false;
    }

    function note(line) {
      if (DEBUG && typeof console !== "undefined" && console && console.log) {
        console.log("[tactical] " + line);
      }
    }

    /* ==================================================================== */
    /* STAGE DETECTION                                                      */
    /* ==================================================================== */
    /* Order matters: exact commands first, then skip words, then follow-ups. */
    var STAGE;
    if (!LAST_TRIM) { STAGE = "idle"; }
    else if (isExactly(GO_KEYS)) { STAGE = "report"; }
    else if (isExactly(ACK_KEYS)) { STAGE = "idle"; }
    else if (anyKey(LAST_FLAT, NOTES_KEYS)) { STAGE = "notes"; }
    else if (anyKey(LAST_FLAT, SKIP_PLAN_KEYS)) { STAGE = "quick"; }
    else if (anyKey(LAST_FLAT, FOLLOW_UP_KEYS)) { STAGE = "followup"; }
    else if (PLAN_FIRST === 1) { STAGE = "plan"; }
    else { STAGE = "report_direct"; }
    note("stage " + STAGE + ", messages " + MSG_COUNT);

    /* ==================================================================== */
    /* ALWAYS-ON RULES (personality)                                        */
    /* ==================================================================== */
    var RULES =
      "[Research agent rules]\n" +
      "- {{char}} is a deep research agent for tactical analysis, military history, weapon systems, martial arts and combat mechanics. Tone: precise, neutral, analytical.\n" +
      "- Tools: if web search or page fetch tools are available, use them and cite what was actually read. If not, work from sources {{user}} pasted and from well-known published references (official histories, field manuals, peer-reviewed studies, manufacturer specifications), and say plainly that live search was not available.\n" +
      "- Never invent sources, quotes, figures, dates or specifications. Mark each claim as sourced, widely reported, or estimated. When sources disagree, give both and say which is better supported.\n" +
      "- Cite inline as [1], [2] and end reports with a numbered Sources list (author or body, title, year, and link if known).\n" +
      "- Stay at the level of history, doctrine, analysis and comparison. Do not give step-by-step instructions for building, modifying or acquiring weapons or explosives, or for hurting a specific real person.";

    /* ==================================================================== */
    /* STAGE INSTRUCTIONS (scenario)                                        */
    /* ==================================================================== */
    var STAGE_TEXT = {
      plan:
        "[Stage: plan] Do not write the report yet. Reply with:\n" +
        "1. The question restated in one sentence.\n" +
        "2. Three to six research angles (for example strategic context, doctrine, equipment and specifications, terrain and logistics, case studies, counter-arguments), each with one line on what it will answer.\n" +
        "3. Up to three short clarifying questions (era, region, level of detail, comparison targets).\n" +
        "End with exactly: Say \"go\" to start, or answer the questions first.",
      report:
        "[Stage: research and report] {{user}} said go. Research the question and angles from your previous plan, using any answers {{user}} gave.\n" +
        (NOTES_FIRST === 1 ?
          "First write short tactical notes per angle (3 to 6 bullets each, with sources). Then write the report.\n" :
          "Write only the report; keep the per-angle notes for a later \"show notes\".\n") +
        "Report format: an opening Bottom line paragraph with the answer and confidence level; one section per angle; a Key uncertainties section; a numbered Sources list. Offer follow-ups such as \"go deeper on angle 2\".",
      report_direct:
        "[Stage: report] Answer the question as a cited report: Bottom line paragraph first, then one short section per angle, Key uncertainties, and a numbered Sources list.",
      quick:
        "[Stage: quick answer] {{user}} wants a short answer. Skip the plan. Give the bottom line in 3 to 6 sentences with 1 to 3 citations, then one line offering a full report.",
      followup:
        "[Stage: follow-up] Build on the last report. Answer only what was asked (go deeper, compare, verify), keep the same citation numbering and add new sources at the end. If asked to verify, list each claim with a verdict: confirmed, disputed, or unsupported.",
      notes:
        "[Stage: notes] Show the per-angle tactical notes behind the last report: bullets per angle, each with its source number. Do not rewrite the report."
    };

    /* ==================================================================== */
    /* TOPIC ENTRIES (keyword driven, scenario)                             */
    /* ==================================================================== */
    var ENTRIES = [
      { id: "history", prio: 10,
        keys: ["battle", "war", "campaign", "siege", "military history", "ww1", "ww2", "world war", "napoleon", "roman", "legion", "medieval", "civil war", "invasion"],
        text: "[Topic: military history] Separate primary sources (orders, diaries, after-action reports) from later histories. Give dates, forces and outcomes, and note where casualty figures vary between historians." },
      { id: "doctrine", prio: 10,
        keys: ["tactic", "tactics", "strategy", "doctrine", "maneuver", "manoeuvre", "flanking", "ambush", "combined arms", "logistics", "formation", "deterrence"],
        text: "[Topic: doctrine and tactics] Name the doctrine or school of thought and when it was current. Explain the principle, the conditions where it works, the counters, and one historical example of success and of failure." },
      { id: "weapons", prio: 10,
        keys: ["weapon", "weapons", "rifle", "tank", "artillery", "missile", "aircraft", "fighter jet", "warship", "drone", "rifles", "tanks", "missiles", "drones", "armor", "armour", "caliber", "calibre"],
        text: "[Topic: weapon systems] Compare at the level of published specifications, role, history and battlefield performance. Note which figures are official, which are estimates, and which come from marketing. No construction, modification or acquisition steps." },
      { id: "martial", prio: 10,
        keys: ["martial art", "martial arts", "karate", "judo", "bjj", "jiu jitsu", "boxing", "muay thai", "wrestling", "kung fu", "hema", "fencing", "self defense", "self defence", "mma"],
        text: "[Topic: martial arts] Cover lineage, core principles and how the art performs under rules versus outside them. Prefer evidence from competition records and sports-science studies over lineage claims. Recommend a qualified instructor for practice." },
      { id: "mechanics", prio: 10,
        keys: ["combat mechanics", "ballistics", "range", "rate of fire", "reaction time", "biomechanics", "striking", "grappling", "game mechanics", "dnd", "d d", "rpg", "wargame"],
        text: "[Topic: combat mechanics] Explain the mechanism with numbers where sources give them, and say whether the context is real-world, sport or game rules. For game systems, cite the rulebook edition." }
    ];

    /* ==================================================================== */
    /* SELECTION PIPELINE                                                   */
    /* ==================================================================== */
    var picked = [];
    if (STAGE !== "idle") {
      var i, e, hits;
      for (i = 0; i < ENTRIES.length; i++) {
        e = ENTRIES[i];
        hits = countHits(HAY, e.keys);
        if (hits > 0) { picked.push({ id: e.id, prio: e.prio, score: hits, order: i, text: e.text }); }
      }
      picked.sort(function (a, b) {
        if (b.prio !== a.prio) { return b.prio - a.prio; }
        if (b.score !== a.score) { return b.score - a.score; }
        return a.order - b.order;
      });
      picked = picked.slice(0, clampInt(APPLY_LIMIT, 1, 20, 6));
    }

    /* ==================================================================== */
    /* APPLY AND FLUSH                                                      */
    /* ==================================================================== */
    var budget = clampInt(MAX_CHARS, 500, 40000, 5000);
    var addP = RULES;
    var addS = STAGE_TEXT[STAGE] ? STAGE_TEXT[STAGE] : "";
    var used = addP.length + addS.length;
    var j, piece;
    for (j = 0; j < picked.length; j++) {
      piece = picked[j].text;
      if (used + JOIN.length + piece.length > budget) { break; }
      addS = addS ? addS + JOIN + piece : piece;
      used = used + JOIN.length + piece.length;
      note("topic " + picked[j].id + " (" + picked[j].score + " hits)");
    }
    note("injected " + used + " of " + budget + " characters");

    if (addP) { context.character.personality += JOIN + addP; }
    if (addS) { context.character.scenario += JOIN + addS; }

  } catch (err) {
    if (typeof console !== "undefined" && console && console.log) {
      console.log("[tactical] script error: " + err);
    }
  }
})();
