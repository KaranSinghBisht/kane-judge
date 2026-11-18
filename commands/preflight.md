---
description: Pre-flight your own project before you submit - find what a judge would find, fix it, and have Kane prove every fix
argument-hint: "<your project folder> --live <your running app, e.g. http://localhost:3000> [check only]"
allowed-tools: Skill, Bash(kane-judge *), Bash(node *kane-judge.mjs*), Read, Write, Edit, Glob, Grep
---

Pre-flight my own project with the Kane Judge skill (`judging`), in pre-flight mode: $ARGUMENTS

Run the Kane Judge CLI as `kane-judge`. If the shell can't find it, use `node "${CLAUDE_PLUGIN_ROOT}/dist/kane-judge.mjs"` instead.

Follow the skill's pre-flight loop: judge my project the way a judge would, then fix what Kane showed broken, in my code or in my README, and re-run the same Kane flow until it passes. Finish with the full run that Kane's verdict engine signs. If I wrote "check only", stop after the findings and change nothing.
