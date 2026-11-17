# Investigating a failed flow

Kane's report for a failed flow gives you:
- the failing step and Kane's own explanation;
- the page it was on;
- browser console errors and failed network requests during that step;
- a screenshot (open it with the Read tool);
- sometimes Kane's own triage.

Decide which of three things happened, using that evidence.

## APP_BROKEN: the product doesn't do what the submission claims

Kane reached the feature the way a user would, and the product failed. Typical signs:
- an error message, or nothing happens on click;
- a wrong value, a missing result, a crash or a blank page;
- console errors or 4xx/5xx responses at that step;
- an element the README promises is missing from the place a user would look.

Mark the claim **broken**. Quote Kane, name the console or network evidence, and keep the screenshot. One clean failure is enough; don't re-run it to "make sure" more than once.

## TEST_WRONG: your flow made a wrong assumption

The feature exists, but your flow went about it wrong. For example:
- a different label, menu or route;
- steps in the wrong order;
- content that loads slowly;
- a README that describes *how* to do it differently from the app.

Rewrite **how** the flow reaches the feature, and keep **what** it checks exactly as the claim promises. You may rewrite a claim at most 2 times, then re-run with `--only <flow>`. If the README described the steps wrongly, mention it as a docs issue in the evidence.

## BLOCKED: you can't check it

Typical causes:
- a login wall with no published demo credentials;
- a wallet, payment, captcha, rate limit or region lock;
- the demo is down (HTTP 0 or 5xx on the start page).

Mark the claim **unverifiable** and say exactly what blocked it. That's a fact about the submission, not a failure of the product, so it never counts as broken.

## Reading Kane's triage

Kane's own triage (`[category, confidence, severity]` in the run output) judges **the test against the app**. You judge **the app against the claim**. Use it as a lead:

- **`automation_bug/test_data_issue`, or other state problems.** For example, "the cart held 2 pens, so $4.20 off was impossible", often after Kane's self-healing re-ran earlier steps in the same browser. This is TEST_WRONG. Make the flow robust to leftover state: start from a known state, or check values relative to what is on screen ("a 10% discount of the shown subtotal"). Then re-run.
- **`automation_bug/state_transition_bug`, or "the expected page isn't there".** When the submission *claims* that page or feature exists, the claim is false: mark it **broken** (an overclaim), not TEST_WRONG. Rewrite only if the feature might live somewhere else, e.g. under a different menu name.
- **Product-bug categories, or console errors and 4xx/5xx at the failing step.** Usually APP_BROKEN.

## Ambiguous

Re-run once, since flakiness is real. If it's still unclear, mark the claim **unverifiable** and explain what Kane saw.

## Record every round

Add each round to the claim's `investigation` in verdict.json:

```json
{ "round": 1, "kane": "failed at step 2: no 'Add to cart' button on the product page", "action": "TEST_WRONG: the button is labelled 'Add to bag'; rewrote step 2" }
{ "round": 2, "kane": "passed: cart badge shows 1", "action": "proven" }
```

The scorecard shows this timeline. That way judges can see that each verdict came from evidence, not from a test that was bent until it passed.
