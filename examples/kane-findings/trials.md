# Trial transcripts

Every run behind the numbers in [`docs/kane-cli-findings.md`](../../docs/kane-cli-findings.md), made on 18 Nov 2026 with Kane CLI 0.10.5 (model `v16-alpha`), Chrome 156, macOS. The page under test is [`site/index.html`](site/index.html), served on `http://localhost:4399/`.

The lines are Kane's own NDJSON events, cut down to the fields that matter (`path` shortened; session ids, log paths and timestamps left out). Each trial flow is a copy of the flow named in its section with only the title changed, so Kane authors each one from scratch.

## A. Plain wording, default assertion mode: 1 false pass in 4 fresh runs

`kane-cli testrun run flows/dom-trial-{1..4}_test.md --agent --headless --parallel 4` (four copies of [`01-total-shown`](flows/01-total-shown_test.md))

```json
{"type": "testrun_authored_member_end", "path": "flows/dom-trial-2_test.md", "status": "failed", "duration_s": 48, "failure": {"message": "Final verification failed: \"the Order summary shows a Total row with the amount $47.00\"", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/dom-trial-3_test.md", "status": "failed", "duration_s": 45, "failure": {"message": "The visible Order summary lacks a Total row; only a hidden $47.00 total exists.", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/dom-trial-1_test.md", "status": "passed", "duration_s": 50}
{"type": "testrun_authored_member_end", "path": "flows/dom-trial-4_test.md", "status": "failed", "duration_s": 53, "failure": {"message": "The Total $47.00 row exists only as hidden content and is not visible in the Order summary.", "step_index": 1}}
{"type": "testrun_summary", "duration_s": 71.298, "totals": {"tests": 4, "passed": 1, "failed": 3, "broken": 0, "skipped": 0, "authored": 4}}
```

## B. Plain wording, `--assertion-mode visual`: 2 false passes in 3 fresh runs

`kane-cli testmd run flows/dom-trial-N_test.md --assertion-mode visual --agent --headless`, one flow at a time, on the same four files as A. Trial 1 replayed the pass it recorded in A (`replay_decisions: 1`); trials 2 to 4 were authored again.

Trial 1:

```json
{"type": "test_md_summary", "duration_s": 8, "overall_status": "passed", "steps": {"total": 1, "passed": 1, "failed": 0, "skipped": 0, "replay_decisions": 1, "author_decisions": 0}}
```

Trial 2:

```json
{"type": "test_md_bug_verdict", "confirmed": true, "bug_title": "Checkout order summary omits Total row", "category": "ui_data_defect", "severity": "major", "confidence": 0.98, "step_index": 1}
{"type": "test_md_summary", "duration_s": 42, "overall_status": "failed", "steps": {"total": 1, "passed": 0, "failed": 1, "skipped": 0, "replay_decisions": 0, "author_decisions": 1}}
```

Trial 3:

```json
{"type": "test_md_summary", "duration_s": 40, "overall_status": "passed", "steps": {"total": 1, "passed": 1, "failed": 0, "skipped": 0, "replay_decisions": 0, "author_decisions": 1}}
```

Trial 4:

```json
{"type": "test_md_summary", "duration_s": 49, "overall_status": "passed", "steps": {"total": 1, "passed": 1, "failed": 0, "skipped": 0, "replay_decisions": 0, "author_decisions": 1}}
```

In the evidence packs of trials 3 and 4 the analyze step is recorded as `ANALYZE(textual_visual, …)`, the assert step passed, and the screenshot Kane saved for that assert step shows no Total row ([`docs/kane-finding-hidden-text.jpg`](../../docs/kane-finding-hidden-text.jpg)).

## C. Replaying the recorded flows: every recorded pass passes again

`kane-cli testrun run flows/dom-trial-{1..4}_test.md --agent --headless --parallel 4`, after A and B.

```json
{"type": "testrun_member_end", "path": "flows/dom-trial-1_test.md", "status": "passed", "duration_s": 11}
{"type": "testrun_member_end", "path": "flows/dom-trial-3_test.md", "status": "passed", "duration_s": 10}
{"type": "testrun_member_end", "path": "flows/dom-trial-4_test.md", "status": "passed", "duration_s": 10}
{"type": "testrun_member_end", "path": "flows/dom-trial-2_test.md", "status": "failed", "duration_s": 41, "failure": {"message": "The required assertion failed because no Total row displaying $47.00 exists.", "step_index": 1}}
{"type": "testrun_summary", "duration_s": 49.19, "totals": {"tests": 4, "passed": 3, "failed": 1, "broken": 0, "skipped": 0, "authored": 0}}
```

## D. "Visibly displayed" wording, default assertion mode: 0 false passes in 6 fresh runs

`kane-cli testrun run flows/visible-trial-{1..6}_test.md --agent --headless --parallel 3` (six copies of [`02-total-visible`](flows/02-total-visible_test.md))

```json
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-2_test.md", "status": "failed", "duration_s": 34, "failure": {"message": "The visible Order summary shows only Subtotal $42.00 and Shipping $5.00, with no Total row or $47.00.", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-3_test.md", "status": "failed", "duration_s": 37, "failure": {"message": "The shopper-visible summary shows only Subtotal and Shipping; no Total row or $47.00 is displayed.", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-1_test.md", "status": "failed", "duration_s": 53, "failure": {"message": "Final verification failed: \"a Total row is visibly displayed on the page, showing the amount $47.00.\"", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-5_test.md", "status": "failed", "duration_s": 34, "failure": {"message": "The visible summary lists only Subtotal $42.00 and Shipping $5.00; no Total row or $47.00 is displayed.", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-6_test.md", "status": "failed", "duration_s": 37, "failure": {"message": "Final verification failed: \"a Total row is visibly displayed on the page, showing the amount $47.00\"", "step_index": 1}}
{"type": "testrun_authored_member_end", "path": "flows/visible-trial-4_test.md", "status": "failed", "duration_s": 50, "failure": {"message": "Final verification failed: \"A Total row is visibly displayed on the page, showing the amount $47.00.\"", "step_index": 1}}
{"type": "testrun_summary", "duration_s": 104.831, "totals": {"tests": 6, "passed": 0, "failed": 6, "broken": 0, "skipped": 0, "authored": 6}}
```

## E. A flow with no steps: reported as passed 3 times out of 3

`kane-cli testrun run flows/03-no-steps_test.md --agent --headless`, three times. Exit code 0 each time.

Run 1:

```json
{"type": "testrun_authored_member_end", "path": "flows/no-steps_test.md", "status": "passed", "duration_s": 5}
{"type": "testrun_summary", "duration_s": 7.358, "totals": {"tests": 1, "passed": 1, "failed": 0, "broken": 0, "skipped": 0, "authored": 1}}
```

Run 2:

```json
{"type": "testrun_authored_member_end", "path": "flows/no-steps_test.md", "status": "passed", "duration_s": 6}
{"type": "testrun_summary", "duration_s": 8.14, "totals": {"tests": 1, "passed": 1, "failed": 0, "broken": 0, "skipped": 0, "authored": 1}}
```

Run 3:

```json
{"type": "testrun_authored_member_end", "path": "flows/no-steps_test.md", "status": "passed", "duration_s": 5}
{"type": "testrun_summary", "duration_s": 8.007, "totals": {"tests": 1, "passed": 1, "failed": 0, "broken": 0, "skipped": 0, "authored": 1}}
```

stderr of each run:

```text
warn: ATM test creation failed: Cannot read properties of undefined (reading 'objective')
code: 'l1.steps.missing',
message: 'L1 requires a steps/ directory'
```

`kane-cli testmd run flows/03-no-steps_test.md --agent --headless` on the same file prints `info: no steps in flows/03-no-steps_test.md; nothing to run.` and reports no test.
