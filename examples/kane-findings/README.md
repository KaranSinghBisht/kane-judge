# Two false passes in Kane CLI 0.10.5

Found while building Kane Judge. Both reproduce in about two minutes with the three flows in this folder. The write-up, with what Kane Judge does about each, is in [`docs/kane-cli-findings.md`](../../docs/kane-cli-findings.md).

```bash
cd examples/kane-findings
python3 -m http.server 4399 --directory site &
kane-cli testrun run flows/01-total-shown_test.md flows/02-total-visible_test.md flows/03-no-steps_test.md --agent --headless
```

[`site/index.html`](site/index.html) is a checkout page whose Total row is in the HTML but hidden with `display:none`. A shopper sees Subtotal and Shipping only.

| Flow | What it asks | Kane's result | Correct result |
| --- | --- | --- | --- |
| `01-total-shown` | "Verify the Order summary shows a Total row with the amount $47.00." | **passed** | fail: no Total is displayed |
| `02-total-visible` | The same check, worded "visibly displayed on the page (not merely present in the page's HTML)". | failed, with a confirmed bug verdict | fail |
| `03-no-steps` | A numbered list instead of `## ` steps, checking for a Total of $999.00 that is nowhere on the page. | **passed** in 1 second, no steps run | not a pass: nothing ran |
