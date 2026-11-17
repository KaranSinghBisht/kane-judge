---
description: Check your own hackathon submission the way judges will, before you submit
argument-hint: "<your-submission-or-repo-url> --live <your-demo-url>"
allowed-tools: Skill, Bash(node *kane-judge.mjs *), Read, Write, Edit, Glob, Grep
---

Pre-flight check my own hackathon submission with the Kane Judge skill (`judging`), in pre-flight mode: $ARGUMENTS

The Kane Judge CLI for this session is:

!`printf 'node "%s/dist/kane-judge.mjs"' "${CLAUDE_PLUGIN_ROOT}"`

Run the full workflow. Then tell me, as the builder: what a judge would find broken (with Kane's evidence and the likely fix), where my README promises more than my demo delivers, and what to clarify before I submit.
