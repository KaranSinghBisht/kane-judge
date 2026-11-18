---
description: Rank every project judged in this folder (SCOREBOARD.md and scoreboard.html)
allowed-tools: Bash(kane-judge *), Bash(node *kane-judge.mjs*)
---

Run `kane-judge board` with the Bash tool. If the shell can't find `kane-judge`, run `node "${CLAUDE_PLUGIN_ROOT}/dist/kane-judge.mjs" board` instead.

Then summarize the ranking in a few lines, and point out any project whose demo was down or whose claims were mostly unverifiable.
