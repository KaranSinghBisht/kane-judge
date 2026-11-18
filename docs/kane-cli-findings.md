# What we learned about Kane CLI while building on it

Kane Judge reports a claim as *proven* only when Kane passes a flow, so a pass that isn't real is the worst thing that can happen to it. Building it turned up two ways Kane CLI 0.10.5 reports a pass without having verified anything. Both are small, both reproduce in about two minutes from [`examples/kane-findings`](../examples/kane-findings), and Kane Judge now defends against both.

Observed on 18 Nov 2026 with Kane CLI 0.10.5 (model `v16-alpha` in the evidence pack), Chrome 156, macOS.

## 1. A check passes on text that is in the page but not displayed

The page ([`site/index.html`](../examples/kane-findings/site/index.html)) has a Total row with `style="display:none"`. A shopper sees Subtotal and Shipping only.

The flow says: *"Verify the Order summary shows a Total row with the amount $47.00."*

Kane **passed** it. The evidence pack records an `analyze` step ("The Order summary Total row has the amount $47.00") and an `assert` step that passed. This is Kane's own screenshot for that passing assert step:

![Kane's screenshot for the passing assert: the Order summary shows Subtotal and Shipping, and no Total](kane-finding-hidden-text.jpg)

The same check worded as *"Verify a Total row is visibly displayed on the page (not merely present in the page's HTML), showing the amount $47.00"* fails, as it should, and Kane's bug verdict confirms a product bug ("Checkout summary omits Total row and $47.00 amount", major, confidence 0.98). So the visual check works; the plain wording just doesn't trigger it.

We first hit this in our own sample shop: an early version of its bug hid the Total with CSS, and Kane reported the promo flow as passing.

**What Kane Judge does about it**
- The flow guide tells the agent to write checks about what is *visibly* shown.
- Kane Judge extracts the final screenshot of every passing flow, and the agent must open it and confirm it shows what the check says before a claim counts as proven. A pass the screenshot doesn't back is treated as a wrong test and rewritten.

## 2. `testrun run` reports a flow with no steps as passed

[`03-no-steps_test.md`](../examples/kane-findings/flows/03-no-steps_test.md) has valid frontmatter, but its body is a numbered list instead of `## ` steps. Its only "check" asks for a Total of $999.00, which is nowhere on the page.

```text
$ kane-cli testrun run flows/03-no-steps_test.md --agent --headless
{"type":"testrun_authored_member_end", … "status":"passed","duration_s":1, …}
{"type":"testrun_summary", … "totals":{"tests":1,"passed":1,"failed":0,"broken":0,"skipped":0,"authored":1}, …}
{"type":"testrun_done", … "overall_status":"passed", …}
exit code 0
```

stderr shows that something went wrong, but an agent reading the NDJSON and the exit code sees one passed test:

```text
warn: ATM test creation failed: Cannot read properties of undefined (reading 'objective')
evidence: sealed pack … failed L1 validation [ { code: 'l1.steps.missing', … message: 'L1 requires a steps/ directory' } ]
```

`kane-cli testmd run` on the same file behaves differently: it prints `info: no steps in …; nothing to run.` and reports no pass.

This is how we found it: in a test run on a clean Claude Code profile, the agent wrote four flows as numbered lists. Kane returned "4 passed" in 8 seconds, and our CLI told the agent to record four proven claims. (The agent noticed the empty step lists and didn't.)

**What Kane Judge does about it**
- `kane-judge run` validates every flow before it calls Kane: a start URL, at least one `## ` step, at least one check. A malformed flow is refused with the format shown, and nothing runs.
- A member Kane reports as passed whose own event log shows no steps is recorded as `no-steps`, never as passed.
- `kane-judge report` refuses a *proven* claim whose flow ran no steps.
- Kane's own verdict engine catches it too. Kane Judge runs `kane-cli evidence verdict` on every sealed pack with [`policies/claims.yaml`](../policies/claims.yaml), and the gate on Kane's `metrics.tests_without_checks` metric fails a run in which a flow passed without an assert step.

## Smaller notes

- **Adaptive heal can leave state behind.** When a replayed step failed, the heal re-ran earlier steps in the same browser, and the cart ended up with two pens. Kane's triage correctly called it a test-data issue. Kane Judge's flow guide asks for checks that stay true either way ("a 10% discount of the shown subtotal"), or for a precondition check first.
- **Kane's bug verdict judges the test against the app.** That is the right job for a test runner, and it is a different question from the judge's: is the *claim* true? When a README promises a page that doesn't exist, Kane says "not a product bug: the test expected a page that isn't there". For a judge that is exactly an overclaim. Kane Judge shows Kane's bug verdict on the scorecard and lets the agent overrule it with Kane's own screenshot as the evidence.
