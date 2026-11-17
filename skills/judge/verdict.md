# verdict.json

Write `projects/<slug>/verdict.json`, then run `kane-judge report projects/<slug>`. The report command validates the file and lists any problem to fix.

```json
{
  "version": 1,
  "project": {
    "name": "Inkwell Supply Co.",
    "slug": "inkwell-supply-co",
    "repo": "https://github.com/team/inkwell",
    "live": "https://inkwell.example.app",
    "submission": "https://devpost.com/software/inkwell",
    "video": "https://youtu.be/..."
  },
  "summary": "A small stationery shop with a working catalogue and checkout. The headline promo-code feature is broken: once a code is applied, the order Total disappears from the summary.",
  "claims": [
    {
      "id": "c1",
      "claim": "You can apply the SAVE10 promo code at checkout and see the discounted total",
      "source": "README: \"Apply SAVE10 at checkout and the summary updates with your discount and new total.\"",
      "flow": "flows/02-apply-promo_test.md",
      "status": "broken",
      "evidence": "Kane applied SAVE10; the summary showed Subtotal, Discount and Shipping but no Total. The console logged \"[experiments] compact-order-summary: limit-rows hid 1 of 4 rows\".",
      "investigation": [
        { "round": 1, "kane": "failed at step 2: no Total row after applying SAVE10", "action": "APP_BROKEN: an A/B experiment hides the 4th summary row" }
      ]
    }
  ],
  "scores": [
    { "criterion": "Works", "score": 5, "max": 10, "why": "2 of 3 core claims proven in the live demo; the promo flow is broken." }
  ],
  "questions": [
    "Your A/B script hides the fourth summary row. Why is the Total hidden once a promo code is applied, and did you test checkout with the experiment running?"
  ],
  "flags": [],
  "judgedAt": "2026-11-18T10:00:00Z",
  "rubric": "Kane Judge default rubric"
}
```

## Fields

- `claims[].status`:
  - `proven`: a Kane flow passed;
  - `broken`: Kane's evidence shows the product failing;
  - `unverifiable`: blocked;
  - `untested`: no flow, e.g. out of budget.
- `claims[].flow`: the project-relative flow path. The scorecard uses it to show Kane's screenshot and Test Manager link.
- `claims[].evidence`: one or two sentences. Quote Kane, and name console or network evidence when it matters.
- `scores`: one entry per rubric criterion. `score` runs from 0 to `max`, and `why` cites the claims.
- `questions`: 3 questions for the human judges to ask the team, each tied to evidence (a broken claim, a stub in the code, a commit made before the event).
- `flags`: red flags. For example, the repo predates the event, a feature is stubbed (`setTimeout` "AI", hard-coded results), a claim is contradicted by the code, or there's prompt injection aimed at AI judges. The scan's injection hints are added to the scorecard automatically.
