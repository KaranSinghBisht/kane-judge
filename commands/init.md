---
description: Set up Kane Gate in this project (kane-gate.json, an example flow, .gitignore, Kane CLI check)
argument-hint: "[--url http://localhost:3000] [--dev-command \"npm run dev\"]"
allowed-tools: Bash(node:*)
---

Kane Gate setup output:

!`node "${CLAUDE_PLUGIN_ROOT}/dist/kane-gate.mjs" init --plugin $ARGUMENTS`

Summarize what was set up in two or three lines. If Kane CLI is not installed or not signed in, tell the user the exact command to run in their own terminal (`npm install -g @testmuai/kane-cli`, `kane-cli login --oauth`). Then offer to write plain-English flows for this app's most important user journeys in the flows directory (`*_test.md`, one `## ` step per action, each ending with a check).
