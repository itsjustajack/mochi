"""Sanitiser for untrusted text, plus a cheap injection look-alike check.

Sanitising lowers the odds of a prompt injection working. It is NOT the safety boundary:
the gate decides every action whatever the model was tricked into asking for.
"""

from __future__ import annotations

import re

# Qwen's ChatML and thinking markers, plus other common chat-template tokens.
_SPECIAL = re.compile(
    r"<\|(?:im_start|im_end|endoftext|eot_id|start_header_id|end_header_id|begin_of_text)\|>"
    r"|</?think>|<\|[a-z_]{2,20}\|>|\[/?INST\]|<</?SYS>>",
    re.IGNORECASE,
)
# Role look-alikes at the start of a line: "### Instruction:", "## Response:", "</user>", "<assistant>"
_ROLES = re.compile(
    r"(?im)^\s*#{1,6}\s*(?:system|instruction|instructions|response|assistant|user)\s*:?"
    r"|</?\s*(?:system|user|assistant|untrusted|tool)\s*>"
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
_BLANKS = re.compile(r"\n{3,}")
_TABS = re.compile(r"\t{8,}")

_INJECTION = re.compile(
    r"ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|rules|prompts?)"
    r"|disregard (?:all |the )?(?:previous|prior|above|your) (?:instructions|rules)"
    r"|you are now (?:a|an|in) "
    r"|new (?:system )?instructions?:"
    r"|(?:enter|switch to|enable) (?:developer|dan|god|jailbreak) mode"
    r"|do not (?:tell|inform) (?:the )?user"
    r"|(?:approved_by|approval)\s*[:=]\s*[\"']?(?:user|jack|yes|true)"
    r"|system prompt",
    re.IGNORECASE,
)


def sanitize(text: str, max_chars: int = 16000) -> str:
    text = str(text)
    for _ in range(10):  # repeat until stable, so nested tricks cannot rebuild a marker
        before = text
        text = _SPECIAL.sub("", text)
        text = _ROLES.sub("", text)
        text = _CONTROL.sub("", text)
        if text == before:
            break
    text = _BLANKS.sub("\n\n", text)
    text = _TABS.sub("\t", text)
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n[cut: {len(text) - max_chars} more characters not shown]"
    return text


def looks_like_injection(text: str) -> bool:
    return bool(_INJECTION.search(str(text)))


def wrap_untrusted(source: str, text: str) -> str:
    safe_source = re.sub(r"[^\w:./\- ]", "", source)[:120]
    return f'<untrusted source="{safe_source}">\n{text}\n</untrusted>'
