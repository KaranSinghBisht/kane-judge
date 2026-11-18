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

## `judged/inkwell-shop/`: the run behind the README's scorecard

Everything Kane Judge wrote while judging the sample: the scan, the four flows Claude wrote (plain English, one per claim), Kane's results across every run, the screenshots Kane took, and the verdict.

```bash
node dist/kane-judge.mjs report examples/judged/inkwell-shop   # rebuild scorecard.html and report.md: no Kane credits
node dist/kane-judge.mjs run examples/judged/inkwell-shop      # re-run the flows with your own Kane account
```

`report` checks the verdict against Kane's results first. After your own `run`, it rebuilds the scorecard only if Kane found what the verdict says it found.
