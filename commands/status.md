---
description: Show Kane Gate's config, flows, pending changes and Kane CLI health
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/kane-gate.mjs" status 2>&1`

Summarize this status in a few lines: which flows exist, what would run next, and anything that needs the user's attention.
