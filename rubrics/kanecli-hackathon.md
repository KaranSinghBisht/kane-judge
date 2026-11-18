# KaneCLI Online Hackathon rubric

Copy this file to `rubric.md` in the folder you judge from. Taken from the event page, https://www.kaneclihack.sh/.

## Bars

A project that misses one of these can't be scored on the rest. Say which bar it missed and what you saw.

1. It works end to end.
2. Kane CLI caught or proved something.
3. The agent and Kane CLI talked to each other.

## Criteria

Each is scored 0 to 10 and counts for a quarter. Cite the claims a score rests on, or say what you couldn't verify.

- **Ships**: a real flow that runs end to end. Not slides.
- **Verified**: Kane CLI caught or confirmed something meaningful.
- **Closed loop**: Kane's result feeds back to the agent. Tighter is better.
- **Craft**: would a developer want to install this tonight?

Ties break on Verified, then on Closed loop.

## What Kane can and can't check here

Most entries are tools: a CLI, a plugin, a GitHub Action. Kane needs a web page to use, so judge what the entry puts in a browser (a hosted demo, a report page, a sample app it tests), and mark the rest unverifiable with the reason. A README that only describes a loop has shown nothing.
