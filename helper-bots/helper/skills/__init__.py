"""Helper skills: named prompt packs and actions an agent can be given in its agent.toml (skill = "...")."""

from helper.skills import deep_research

SKILLS = {deep_research.NAME: deep_research}
