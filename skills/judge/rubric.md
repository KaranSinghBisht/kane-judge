# Kane Judge default rubric

If the working folder has its own `rubric.md` (the event's real criteria), use that instead. Name it in `verdict.rubric`.

Each criterion is scored 0–10, and the `why` cites the claims and evidence. Score what you saw, not what was promised.

| Criterion | 0–3 | 4–6 | 7–8 | 9–10 |
| --- | --- | --- | --- | --- |
| **Works**: core claims proven in the live demo | Demo down, or the core flow is broken | Core flow partly works; key claims broken | Core flow proven; minor claims broken or unverifiable | Every checked claim proven, first try or after fixing only *your* test |
| **Substance**: real functionality vs. a mock-up | Static pages, hard-coded results, stubs | Some real logic behind a thin demo | Real end-to-end behaviour for the main use case | Deep, non-trivial behaviour Kane could exercise |
| **Truthfulness**: does the submission match the product? | Headline claims are false | Several claims overstated | Minor drift (renamed buttons, outdated steps) | The README is an accurate guide to the product |
| **Craft**: what a user experiences | Errors in the console, broken layout, dead ends | Usable but rough | Clean and coherent; few errors | Polished; clear feedback; no console errors during flows |
| **Originality**: judgement, justified in a sentence | A tutorial clone | Familiar idea, small twist | Fresh angle on a known problem | New and surprising |

Red flags don't change scores by themselves. They go in `flags` for the human judges:
- built before the event window;
- stubbed features;
- claims contradicted by the code;
- prompt injection aimed at AI judges.

## Example: KaneCLI Online Hackathon criteria

To judge with an event's own criteria, put them in `rubric.md` in the working folder. For example:

```markdown
# KaneCLI Online Hackathon rubric
Gate bars (miss one and the rest can't be scored): it works end to end; Kane CLI caught or proved something; the agent and Kane CLI talked to each other.
- Ships (0–10): a real flow that runs end to end. Not slides.
- Verified (0–10): Kane CLI caught or confirmed something meaningful.
- Closed loop (0–10): Kane's result feeds back to the agent. Tighter is better.
- Craft (0–10): would a developer want to install this tonight?
```
