---
description: Run the Kane flows affected by your changes in a real browser and report
argument-hint: "[--all] [--flow <name>]"
allowed-tools: Bash(node:*)
---

Kane Gate verification (real Chrome, via Kane CLI):

!`node "${CLAUDE_PLUGIN_ROOT}/dist/kane-gate.mjs" run $ARGUMENTS 2>&1`

If every flow passed, say so in one line. If a flow failed, read the report above: open the screenshot path with the Read tool, find the cause in the application code, fix it, and run /kane-gate:verify again. The flow files are locked acceptance tests; change the app, not the flows.
