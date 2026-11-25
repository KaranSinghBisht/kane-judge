# What the tests actually prove

The original 494 passing tests were useful, mostly small parser, evidence-extraction and rule checks. They were not 494 browser tests, and they did not prove that a fresh install, the complete CLI, or the submission was ready. The November 24 audit reproduced false scorecards that the entire original suite missed.

## Verification layers

| Layer | Boundary exercised | What it does not establish |
| --- | --- | --- |
| Parser/rule tests | NDJSON, flow discovery, evidence ZIPs, verdict rules and report rendering | A running browser or a successful install |
| `test/report-contract.test.ts` | Edits to the real committed Kane run, through the report checker | Protection against a person replacing both evidence and every recorded hash |
| `test/cli-process.test.ts` | A real bundled CLI process, with a deliberately simulated Kane executable; argv, NDJSON, policy calls, disk state, locks and exit codes | Kane's AI or Chrome behavior |
| `npm run test:package` | The actual npm tarball installed offline into a clean prefix, including its npm executable, executed without dev dependencies or Kane on PATH | Public GitHub access, Claude marketplace installation or OAuth |
| `npm run audit:mutations` | Eight deliberate breaks to important evidence rules, each required to make a real test fail | A whole-project mutation score or exhaustive coverage |
| `npm run test:browser` | Fresh Chromium contexts exercise the bundled shop before and after its repair, the eight playground presets, the mobile layout and keyboard replay | Every browser, assistive technology or screen size |
| Live Kane runs | Real Chrome, real flows, real sealed packs and policy evaluation | Every app, login flow, mobile device, or future Kane version |

Development checks need Node 22.12+ or another version supported by Vitest 5. The bundled CLI needs Node 20+. The packaged executable was tested on Node 20 and 22. GitHub Actions runs the build and package checks on Linux with Node 22 and 24, and the checkout and scorecard replay on Node 22. [See runs for main](https://github.com/KaranSinghBisht/kane-judge/actions/workflows/check.yml?query=branch%3Amain).

The v0.3 marketplace was also installed from the private GitHub repository into a fresh Claude Code config using an authorized Git identity. Its bundled demo verified the pack and refused all eight edits. The package smoke check also compares the installed CLI, plugin and marketplace versions.

```bash
npm ci
npm run check          # typecheck; build current CLI before tests; build static demo
npm run test:package
npm run audit:mutations
```

The mutation script temporarily edits source and restores it on completion. Run it without concurrent edits to those source files. Its scope and results are in `docs/audit/mutation-results.json`.

## Reproduce the checkout repair

After `npm ci`, install the test browser once and run the following from the repository root.

```bash
npx playwright-core install chromium --only-shell
npm run test:browser
```

The check launches the bundled shop on a temporary loopback port, adds a Brass Pen and applies SAVE10. It verifies the missing Total and the console line that names the experiment. It applies the [recorded repair](examples/preflight/inkwell-shop/checkout-repair.patch) to the temporary copy, opens a fresh browser context, repeats the interaction and requires a visible $42.80 Total. Both runs require the $4.20 discount. This is an independent browser control. The original Kane evidence and Kane policy verdicts are linked below.

## Real positive and negative controls, November 24

- **Fixed local shop:** four active flows replayed with healing off. Kane CLI 0.10.5 passed all four and all six policy gates. Kane CLI 0.10.8 also passed all four serially (`--parallel 1`). Evidence: `examples/preflight/inkwell-shop`.
- **Broken deployed shop:** the exact same promo flow text failed against `https://inkwell-shop.vercel.app`, which intentionally retains the missing-Total bug. Kane confirmed the defect, its policy failed, and the gate exited 1. This is a narrow control, not a full submission score. Evidence: `examples/negative/deployed-promo`.
- **Infrastructure failure:** an initial 0.10.8 run with four workers had two native-runner `SIGBUS` crashes. It failed the gate. The history preserves that run; those crashes cannot establish a broken-product claim or a product fix. Serial retry passed. The cause of the crash has not been established.
- Screenshots of the positive run were inspected: cart badge 2, checkout $47.00, an order confirmation, and SAVE10 Total $42.80. Pack copies were accepted by `kane-cli evidence validate`.

Re-run a shared pack without logging in:

```bash
cd examples/preflight/inkwell-shop
kane-cli evidence verdict packs/622e6348-7301-4141-9df3-431a40ba3743.evidence --policy kane-judge-claims.policy.yaml
```

## Check the hosted release

The browser test serves the generated `public-demo/` directory locally, checks that a damaged download is refused, retries with the real packs and follows the evidence links. To exercise the deployed site in a fresh browser:

```sh
node scripts/check-hosted-demo.mjs https://kane-judge.vercel.app/
```

The independent [Kane acceptance run](examples/hosted-demo/README.md) includes the actual production flow, screenshot and scrubbed pack. GitHub Actions runs the Playwright checks without a Kane account.

To rebuild the Vercel demo, import the repository root with its committed `vercel.json`. The build writes only the visitor-facing pages and the two scrubbed shop controls to `public-demo/`. The bundled CLI and local checks also work from a clone.

## Release gates still outside local checks

The last-day submission needs a public repository and the real YouTube and two public-post links. Registration and TestMu account eligibility are account facts the repository cannot establish. No automated test marks these complete.

The official deadline is **November 26, 11:59 PM IST**, extended from November 19: <https://www.kaneclihack.sh/>.
