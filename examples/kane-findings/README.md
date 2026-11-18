# Two false passes in Kane CLI 0.10.5

Found while building Kane Judge. The write-up, with what Kane Judge does about each, is in [`docs/kane-cli-findings.md`](../../docs/kane-cli-findings.md). Every run behind its numbers is in [`trials.md`](trials.md).

```bash
cd examples/kane-findings
python3 -m http.server 4399 --directory site &
kane-cli testrun run flows/01-total-shown_test.md flows/02-total-visible_test.md flows/03-no-steps_test.md --agent --headless
```

About two minutes and 50 Kane credits. [`site/index.html`](site/index.html) is a checkout page whose Total row is in the HTML but hidden with `display:none`. A shopper sees Subtotal and Shipping only.

| Flow | What it asks | What Kane reported in our runs | Correct result |
| --- | --- | --- | --- |
| `01-total-shown` | "Verify the Order summary shows a Total row with the amount $47.00." | **passed in 3 of 7 fresh runs** (1 of 4 in the default mode, 2 of 3 with `--assertion-mode visual`). Every replay of a recorded pass passed again (4 of 4). | fail: no Total is displayed |
| `02-total-visible` | The same check, worded "visibly displayed on the page (not merely present in the page's HTML)". | failed in 6 of 6 fresh runs | fail |
| `03-no-steps` | A numbered list instead of `## ` steps, checking for a Total of $999.00 that is nowhere on the page. | **passed in 3 of 3 runs**, in about 5 seconds, no steps run | not a pass: nothing ran |

The first one is intermittent, so one run may come back right. Copy the flow under a few names and run them together, as [`trials.md`](trials.md) does, to see both answers. A flow that once passed keeps passing on replay; delete its `flows/output-*` folder, or change its title, to have Kane author it again.
