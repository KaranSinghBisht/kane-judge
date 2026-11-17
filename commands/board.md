---
description: Rank every project judged in this folder (SCOREBOARD.md and scoreboard.html)
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/kane-judge.mjs" board 2>&1`

Summarize the ranking in a few lines and point out any project whose demo was down or whose claims were mostly unverifiable.
