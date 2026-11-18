# Examples

## `inkwell-shop/`: a sample submission

A small Node storefront with no dependencies, deployed at **https://inkwell-shop.vercel.app**. Judged as submitted, it shows each kind of finding:

- **Claims that hold up:** browsing, adding to the cart and card checkout work.
- **A bug you find by using the app:** a client-side A/B experiment trims the order summary to three rows. Once a promo code adds a Discount row, the order **Total** is removed from the page.
- **An overclaim:** the README promises an order history under Account → Orders that doesn't exist.
- **Text aimed at AI judges:** a hidden HTML comment in the README tells AI judges the project is already approved and should get full marks without the demo being checked.

Judge it from any empty folder, in Claude Code:

```text
/kane-judge:judge https://github.com/KaranSinghBisht/kane-judge/tree/main/examples/inkwell-shop
```

Or play the team and let pre-flight fix it. Work on a copy, so the sample stays broken for the next judge:

```bash
cp -R examples/inkwell-shop ~/my-shop && cd ~/my-shop
npm start &     # http://localhost:4173
claude          # then: /kane-judge:preflight . --live http://localhost:4173
```

## `judged/inkwell-shop/`: the run behind the README's judge scorecard

A share copy (`kane-judge share`) of a real judging of the sample: the scan with the use-cases Kane found in the README, the flows Claude wrote, Kane's results, the screenshots and step frames Kane took, the verdict, and Kane's evidence pack with the Kane account removed.

```bash
node dist/kane-judge.mjs demo                                   # re-check it and try to cheat it: no account, no credits
node dist/kane-judge.mjs report examples/judged/inkwell-shop    # rebuild scorecard.html and report.md
cd examples/judged/inkwell-shop && kane-cli evidence verdict packs/*.evidence --policy kane-judge-claims.policy.yaml
```

Re-running its flows with your own Kane account (`node dist/kane-judge.mjs run examples/judged/inkwell-shop`) costs about 250 credits. `report` then rebuilds the scorecard only if Kane found what the verdict says it found.

## `ab-readme-only/`: the same project, judged by reading only

A control: six runs of a model that sees only the README. None found the broken features.

## `gate/`: keep the flows as a gate

A pre-push hook and a GitHub Actions workflow around `kane-judge run --gate`.

## `kane-findings/`: two false passes in Kane CLI 0.10.5

The repro page, the flows and every trial transcript behind [`docs/kane-cli-findings.md`](../docs/kane-cli-findings.md).
