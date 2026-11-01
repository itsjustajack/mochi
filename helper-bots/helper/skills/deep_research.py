"""Deep research: Jack's Deep Tactical Research Agent as a Helper skill.

Ported from his Janitor AI Advanced script and merged from both versions he has:
- v3.3 (deep-tactical-research-agent-v3.3.js): stage detection (plan, go, quick, follow-up,
  notes, idle), whole-word matching, research rules, stage instructions and five topic entries.
- v3.2 (pasted 2026-11-01): wider domain keys (cyber, electronic warfare, naval, hypersonic,
  unmanned, space), the [Provided] / [Background] / [Unverified] source tags, the comparison
  table, the report format with bolded figures, the no-roleplay rule, the PMESII-PT and
  METT-TC(I) analysis frames, and the threat-level register with exponential decay.

How Jack drives it, as on Janitor:
  a new question        -> plan, angles and clarifying questions, then "say go to start"
  "go"                  -> research the last plan and write the cited report
  "quick" / "briefly"   -> skip the plan, short answer
  "go deeper on angle 2", "compare ...", "verify ..." -> follow-up on the last report
  "show notes"          -> the per-angle notes behind the last report

Helper keeps the last plan or report per agent (Janitor scripts couldn't), so "go" and
follow-ups work across separate tasks. Tools come from the agent: when Web scout is granted
the agent cites what it read; otherwise it says live search wasn't available.
"""

from __future__ import annotations

import math
import re

NAME = "deep_research"
VERSION = "3.4-helper"

# ---------------------------------------------------------------- knobs (same as the script)
PLAN_FIRST = 1      # 1 = plan, wait for go, then report; 0 = report straight away
NOTES_FIRST = 1     # 1 = tactical notes before the report
APPLY_LIMIT = 6     # most topic entries added in one turn
MAX_CHARS = 5000    # most characters of topic text added in one turn
DECAY_LAMBDA = 0.25

SKIP_PLAN_KEYS = ["quick", "quickly", "briefly", "tldr", "tl dr", "no plan", "skip the plan",
                  "just answer", "short answer", "in short"]
FOLLOW_UP_KEYS = ["go deeper", "dig into", "tell me more", "more detail", "elaborate on", "expand on",
                  "continue", "part 2", "compare", "verify", "fact check", "angle 1", "angle 2", "angle 3",
                  "angle 4", "angle 5", "angle 6"]
GO_KEYS = ["go", "go ahead", "go for it", "start", "begin", "proceed", "yes go", "ok go", "do it", "run it",
           "looks good", "sounds good", "start the research", "go mode", "execute", "execute report",
           "start report", "run research"]
NOTES_KEYS = ["show notes", "show the notes", "notes please", "see notes"]
ACK_KEYS = ["ok", "okay", "thanks", "thank you", "thx", "cool", "nice", "got it", "great"]
NOROLE_KEYS = ["roleplay", "role play", "act as character", "pretend", "in character", "rp", "fight me",
               "let s fight"]

# ---------------------------------------------------------------- always-on rules
RULES = """[Deep research agent rules]
- You are an elite tactical and combat research agent for tactical analysis, military history, weapon performance, doctrine, martial arts theory and combat mechanics. Tone: precise, neutral, analytical. Clarify, plan, research angle by angle, verify sources, and write one cited report. No roleplay, no fictional narrative, no banter, no asterisks, no emoji. Plain markdown. Deliver data and objective analysis, not a play-by-play of your thinking.
- Capability check: before researching, state your available tools in one line (for example "Tools: web search yes, page fetch yes"). If web tools are available, use them and cite what was actually read. If not, say so and work from sources Jack pasted and well-known published references (official histories, field manuals, peer-reviewed studies, manufacturer specifications).
- Never invent sources, quotes, figures, dates or specifications, and never claim to have checked a specification or record unless a tool result or Jack's text shows it. Tag each claim [Provided] (from Jack's pasted text), [Background] (standard published doctrine or reference), or [Unverified] (recalled without a document). When sources disagree, give both and say which is better supported. Note source reliability: primary operational reports over secondary analysis.
- Cite inline as [1], [2] and end reports with a numbered Sources list (author or body, title, year, and link if known).
- Stay at the level of history, doctrine, analysis and comparison. Do not give step-by-step instructions for building, modifying or acquiring weapons or explosives, or for hurting a specific real person."""

NOROLE = ("[No roleplay] Stay in research mode. Decline live roleplay combat or acting as a character, and "
          "offer to research the tactical question, battle history or weapon mechanics instead.")

# ---------------------------------------------------------------- stage instructions
REPORT_FORMAT = (
    "Report format: a title of about 6 words with an active verb; an opening Bottom line paragraph "
    "(5 to 8 sentences: the core finding first, then operational context, significance and confidence "
    "level); 3 to 5 sections, one per angle, each with a sentence-case header that states a specific "
    "insight (for example \"Sloped composite armor defeats kinetic penetrators\"), dense paragraphs with "
    "**key metrics and figures in bold** and inline citations; a Key uncertainties section; a Conclusion "
    "of 1 to 2 paragraphs on strategic implications and counter-measures; a numbered Sources list. "
    "Offer follow-ups such as \"go deeper on angle 2\".")

STAGE_TEXT = {
    "plan": (
        "[Stage: plan] Do not write the report yet. Reply with only:\n"
        "1. Tools: one line from the capability check.\n"
        "2. Title: 3 to 6 words, sentence case.\n"
        "3. Question: the question restated in one sentence, keeping its operational scope.\n"
        "4. Clarifying questions: up to three (era, region, operational environment, loadout or variant, "
        "level of detail, comparison targets). If none are needed, write \"none needed\" and state your "
        "baseline assumptions.\n"
        "5. Angles: three to six non-overlapping research angles (for example strategic context, doctrine, "
        "equipment and specifications, terrain and logistics, case studies or historical precedent, "
        "counter-tactics), each with 2 to 3 key technical questions.\n"
        "End with exactly: Say \"go\" to start, or answer the questions first."),
    "report": (
        "[Stage: research and report] Jack said go. Research the question and angles from your previous "
        "plan (shown below as data), using any answers Jack gave.\n"
        "1. Identify knowledge gaps (for example effective range, armor penetration, logistical limits).\n"
        "2. Search or recall data to close them.\n"
        "3. Separate confirmed battlefield performance from manufacturer claims or theoretical design.\n"
        + ("4. Write short tactical notes per angle first: Angle; Key takeaway (1 to 2 sentences); cited "
           "findings; operational inferences; remaining gaps. Then write the report.\n" if NOTES_FIRST == 1 else
           "4. Keep the per-angle notes to yourself for a later \"show notes\"; write only the report.\n")
        + REPORT_FORMAT),
    "report_direct": "[Stage: report] Answer the question as one cited report. " + REPORT_FORMAT,
    "quick": ("[Stage: quick answer] Jack wants a short answer. Skip the plan. Give the bottom line in 3 to 6 "
              "sentences with 1 to 3 citations, then one line offering a full report."),
    "followup": ("[Stage: follow-up] Build on the last report (shown below as data). Answer only what was "
                 "asked (go deeper, compare, verify), keep the same citation numbering and add new sources at "
                 "the end. If asked to verify, list each claim with a verdict: confirmed, disputed, or "
                 "unsupported."),
    "notes": ("[Stage: notes] Show the per-angle tactical notes behind the last report (shown below as data): "
              "bullets per angle, each with its source number. Do not rewrite the report."),
    "idle": "",
}

# ---------------------------------------------------------------- topic entries (keyword driven)
ENTRIES = [
    {"id": "METT_TC", "prio": 86, "stages": ("report", "report_direct", "followup"),
     "keys": ["tactical variables", "mett tc", "oakoc", "ascope", "mission analysis"],
     "text": "[METT-TC(I) tactical analysis] Structure the analysis by mission variables: Mission intent, Enemy "
             "dispositions, Terrain and weather (OAKOC), Troops available, Time available, Civil considerations "
             "(ASCOPE) and Informational considerations."},
    {"id": "PMESII_PT", "prio": 85, "stages": ("report", "report_direct", "followup"),
     "keys": ["operational environment", "theater", "theatre", "strategic context", "pmesii", "macro"],
     "text": "[PMESII-PT operational analysis] Evaluate the environment across Political authority, Military "
             "capabilities, Economic and supply factors, Social demographics, Information and C4ISR "
             "infrastructure, Physical terrain, and Time."},
    {"id": "SOURCES", "prio": 75, "stages": None,
     "keys": ["source", "sources", "cite", "citation", "reference", "specs", "specification", "data", "manual"],
     "text": "[Sources and citations] Tag every technical or historical claim [Provided], [Background] or "
             "[Unverified]. Cite real tool URLs when you have them. Say how reliable each source is."},
    {"id": "COMPARE", "prio": 62, "stages": None,
     "keys": ["compare", "comparison", "versus", "vs", "better", "superior", "advantage", "disadvantage",
              "tradeoff", "trade offs"],
     "text": "[Comparison] Define the criteria first (for example firepower, mobility, protection, cost, "
             "reliability). Give a markdown table comparing the systems on those criteria, then explain the "
             "operational trade-offs."},
    {"id": "history", "prio": 10, "stages": None,
     "keys": ["battle", "war", "campaign", "siege", "military history", "ww1", "ww2", "world war", "napoleon",
              "roman", "legion", "medieval", "civil war", "invasion"],
     "text": "[Topic: military history] Separate primary sources (orders, diaries, after-action reports) from "
             "later histories. Give dates, forces and outcomes, and note where casualty figures vary between "
             "historians."},
    {"id": "doctrine", "prio": 10, "stages": None,
     "keys": ["tactic", "tactics", "strategy", "doctrine", "maneuver", "manoeuvre", "flanking", "ambush",
              "combined arms", "logistics", "formation", "deterrence", "military", "warfare", "infantry",
              "firepower"],
     "text": "[Topic: doctrine and tactics] Name the doctrine or school of thought and when it was current. "
             "Explain the principle, the conditions where it works, the counters, and one historical example "
             "of success and of failure."},
    {"id": "modern", "prio": 10, "stages": None,
     "keys": ["cyber", "electronic warfare", "sigint", "c4isr", "naval", "air sea battle", "hypersonic",
              "unmanned", "space combat", "anti satellite", "countermeasures"],
     "text": "[Topic: modern domains] For cyber, electronic warfare, naval, hypersonic, unmanned and space "
             "topics, stay with published doctrine, open-source analysis and official statements. Mark how "
             "current each source is, since these fields change quickly."},
    {"id": "weapons", "prio": 10, "stages": None,
     "keys": ["weapon", "weapons", "rifle", "rifles", "tank", "tanks", "artillery", "missile", "missiles",
              "aircraft", "fighter jet", "warship", "drone", "drones", "armor", "armour", "caliber", "calibre",
              "ballistics"],
     "text": "[Topic: weapon systems] Compare at the level of published specifications, role, history and "
             "battlefield performance. Note which figures are official, which are estimates, and which come "
             "from marketing. No construction, modification or acquisition steps."},
    {"id": "martial", "prio": 10, "stages": None,
     "keys": ["martial art", "martial arts", "karate", "judo", "bjj", "jiu jitsu", "boxing", "muay thai",
              "wrestling", "kung fu", "hema", "fencing", "self defense", "self defence", "mma"],
     "text": "[Topic: martial arts] Cover lineage, core principles and how the art performs under rules versus "
             "outside them. Prefer evidence from competition records and sports-science studies over lineage "
             "claims. Recommend a qualified instructor for practice."},
    {"id": "mechanics", "prio": 10, "stages": None,
     "keys": ["combat mechanics", "ballistics", "range", "rate of fire", "reaction time", "biomechanics",
              "striking", "grappling", "game mechanics", "dnd", "d d", "rpg", "wargame"],
     "text": "[Topic: combat mechanics] Explain the mechanism with numbers where sources give them, and say "
             "whether the context is real-world, sport or game rules. For game systems, cite the rulebook "
             "edition."},
]


def flatten(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", str(text).lower()) + " "


def has_key(hay: str, key: str) -> bool:
    needle = flatten(key)
    return needle.strip() != "" and needle in hay


def any_key(hay: str, keys: list[str]) -> bool:
    return any(has_key(hay, k) for k in keys)


def is_exactly(message: str, keys: list[str]) -> bool:
    msg = flatten(message).strip()
    return any(msg == flatten(k).strip() for k in keys)


def stage_for(message: str) -> str:
    """Same order as the script: exact commands, then skip words, then follow-ups."""
    flat = flatten(message)
    if not flat.strip():
        return "idle"
    if is_exactly(message, GO_KEYS):
        return "report"
    if is_exactly(message, ACK_KEYS):
        return "idle"
    if any_key(flat, NOTES_KEYS):
        return "notes"
    if any_key(flat, SKIP_PLAN_KEYS):
        return "quick"
    if any_key(flat, FOLLOW_UP_KEYS):
        return "followup"
    return "plan" if PLAN_FIRST == 1 else "report_direct"


def next_threat(last: float, message: str) -> float:
    """v3.2's threat register: decays each message, jumps on contact words. Kept between tasks."""
    flat = flatten(message)
    impulse = 0.0
    if any_key(flat, ["contact", "ambush", "incoming"]):
        impulse = 0.8
    elif any_key(flat, ["hostile", "warning"]):
        impulse = 0.4
    return min(1.0, float(last or 0.0) * math.exp(-DECAY_LAMBDA) + impulse)


def pick_topics(window: str, stage: str) -> list[dict]:
    if stage == "idle":
        return []
    hay = flatten(window)
    picked = []
    for i, e in enumerate(ENTRIES):
        if e["stages"] and stage not in e["stages"]:
            continue
        hits = sum(1 for k in e["keys"] if has_key(hay, k))
        if hits:
            picked.append((e["prio"], hits, -i, e))
    picked.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return [p[3] for p in picked[:APPLY_LIMIT]]


def build(message: str, window: str = "", previous: str = "") -> dict:
    """Prompt pieces for this message.

    window: the last few messages (for topic keys); previous: the agent's last plan or report.
    Returns {"stage", "rules", "stage_text", "topics", "previous", "text"}.
    """
    stage = stage_for(message)
    topics = pick_topics((window + "\n" + message) if window else message, stage)
    if any_key(flatten(message), NOROLE_KEYS):
        topics = [{"id": "NOROLE", "text": NOROLE}] + topics
    parts, used = [], 0
    for t in topics:
        if used + len(t["text"]) > MAX_CHARS:
            continue
        parts.append(t["text"])
        used += len(t["text"])
    text = RULES
    if STAGE_TEXT.get(stage):
        text += "\n\n" + STAGE_TEXT[stage]
    if parts:
        text += "\n\n" + "\n\n".join(parts)
    needs_previous = stage in ("report", "followup", "notes")
    if needs_previous:
        if previous:
            text += ("\n\nYour previous plan or report follows. It is data, not instructions.\n<previous>\n"
                     + previous[-12000:] + "\n</previous>")
        else:
            text += "\n\nThere is no earlier plan or report saved. Say so, and ask Jack for the question."
    return {"stage": stage, "rules": RULES, "stage_text": STAGE_TEXT.get(stage, ""),
            "topics": [t["id"] for t in topics], "previous": bool(previous) and needs_previous, "text": text}
