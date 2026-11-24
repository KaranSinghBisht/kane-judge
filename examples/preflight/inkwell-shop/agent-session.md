# How the agent repaired the missing Total

On November 18 the agent ran pre-flight on its own copy of Inkwell. These are selected tool calls and returned lines from the recorded Claude Code session, in their original order. File paths are relative to the sample or its evidence folder. Later November 24 control runs are recorded separately in the run history.

| Session line | Tool action or output | Evidence |
| --- | --- | --- |
| 155 | Ran `kane-judge run projects/my-shop`. | [Promo flow](flows/04-apply-promo_test.md) |
| 167 | Kane returned the browser console warning `compact-order-summary: limit-rows removed 1 of 4 rows in #order-summary`. | [First run, failed](evidence/04-apply-promo-run1-failed.jpg) |
| 178, 210 | Read the failure screenshot, then `data/experiments.json`. | The screenshot ends at Shipping. |
| 294 | Edited the compact-order-summary experiment from `running` to `stopped`. | [Exact patch](checkout-repair.patch) |
| 302, 309 | Ran `kane-judge run projects/my-shop --only 04-apply-promo` and read its screenshot. | [Same flow, passed](evidence/04-apply-promo-run2-passed.jpg) |
| 343 | Withdrew the unimplemented order-history claim after editing the README. | [README after withdrawal](README.after.md) |
| 349, 353, 364 | Ran `kane-judge run projects/my-shop --gate`. Kane returned four passes in 31 seconds with healing off. The agent read the gate screenshot. | [Gate screenshot](evidence/04-apply-promo-run3-passed.jpg) |
| 494, 495 | Ran `kane-judge report projects/my-shop`. It returned four of five claims proven, one repaired and one withdrawn. | [Report](report.md) |

The checkout test's SHA-256 is `46e34444d2cdd383c1c7bcc371b0ea0d579db3f01fabde08e7f451b86c9df2d9`. The report checker also compares the test text inside the failed and passing packs. The [independent checkout replay](../../../TESTING.md#reproduce-the-checkout-repair) applies the patch to a temporary copy and requires the discounted Total to be visible.
