# Kane Gate

**Your coding agent can't say "done" until a real browser agrees.**

Kane Gate is a Claude Code plugin that puts [Kane CLI](https://github.com/LambdaTest/kane-cli) between Claude and the end of every turn. When Claude tries to stop after changing your app, Kane Gate runs the affected plain-English browser flows in real Chrome. If one fails, Claude doesn't get to stop. It gets Kane's report instead: the failing step, what Kane saw, the browser's console errors, failed requests and a screenshot. Claude keeps working until the flows pass, and you get a receipt.

```text
  you: "add a promo code field"            Claude edits the app
                                                    │
                                                    ▼
                                     Claude tries to end its turn
                                                    │
                                    Stop hook ──────┤  what changed since the last green run?
                                                    ▼
                               kane-cli testrun: the affected *_test.md flows, real Chrome
                                                    │
                    ┌──────────── fail ─────────────┴───────────── pass ────────────┐
                    ▼                                                               ▼
  stop blocked; Claude gets the failing step, Kane's words,          ✓ receipt: flows, time,
  console errors, failed requests and a screenshot to open           evidence pack, Test Manager link
                    │
                    └──► Claude fixes the app (the flows are locked) ──► tries to stop again
```

## Why

Agents check their work with the tools they have: type checks, unit tests, reading the code. None of those open the page.

The demo in this repo has exactly that bug. A growth-team A/B script trims the shop's order summary to three rows. Claude adds a promo code with a Discount row, and every check it can run passes. In a real browser, the order **Total** silently disappears. Kane Gate catches it before Claude says "done", hands Claude the evidence, and lets it stop only once the checkout works.

## Install

You need Node 20+, Google Chrome and a free [TestMu AI](https://www.testmuai.com/kane-cli/) account (new accounts get 10,000 Kane CLI credits).

1. **Kane CLI**
   ```bash
   npm install -g @testmuai/kane-cli
   kane-cli login --oauth
   ```
2. **The plugin**, inside Claude Code:
   ```text
   /plugin marketplace add KaranSinghBisht/kane-gate
   /plugin install kane-gate@kane-gate
   ```
3. **Your project**, inside Claude Code:
   ```text
   /kane-gate:init --url http://localhost:3000 --dev-command "npm run dev"
   ```
   This writes `kane-gate.json`, an example flow in `kane/flows/`, and adds `.kane-gate/` to `.gitignore`.
4. **Describe your key user journeys** as flows (below), then record them once with `/kane-gate:verify --all`. Later runs replay from Kane's cache in seconds.

That's it. Work with Claude as usual.

Not using plugins? `npm install -g github:KaranSinghBisht/kane-gate`, then `kane-gate init` in your project wires the same hooks into `.claude/settings.json`.

## Flows are plain English

A flow is a Kane [`_test.md`](https://github.com/LambdaTest/kane-cli/blob/main/docs/user-guide/testmd/overview.md) file. Each `## ` step is one thing a user does, ending with a check:

```markdown
---
url: http://localhost:4173
tags: [checkout, promo]
---

# Pay less with a promo code

## Put a pen in the cart
Open http://localhost:4173, click "Add to cart" on the Brass Pen card, then click the Cart link in the header. Verify the checkout page lists the Brass Pen.

## Apply the SAVE10 code
Enter SAVE10 in the promo code field and apply it. Verify the order summary shows a discount of $4.20 and a Total of $42.80.
```

Flows are your acceptance tests, so Kane Gate **locks** them: Claude can add new flows but can't edit existing ones to make a check pass.

## What Kane Gate guarantees

- **The loop closes itself.** No "please test it" prompts. Every stop after an app change is verified, and failures go straight back to Claude as its next instruction.
- **Claude can't grade its own homework.** A PreToolUse guard denies edits to flows, `kane-gate.json` and `.kane-gate/`, through Edit, Write, MultiEdit, NotebookEdit and shell writes (`sed -i`, `>`, `rm`, `git checkout`, …).
- **Evidence, not vibes.** Reports come from Kane's sealed evidence pack: the failure record, console errors and failed network calls during the failing step, and the annotated screenshot, extracted so Claude can open it.
- **It never traps the agent.** At most `maxAttempts` blocks per prompt, then Claude stops with a "needs a human" summary. Kane sign-in, Chrome or timeout problems never block; Claude stops with a clear warning. Internal errors fail open.
- **It only runs what changed.** Changes are measured against the last green run (git-aware), and each flow can declare the files it covers. No changes means no run and no credits.
- **New behaviour gets a test.** If Claude changes files no flow covers, it's asked once to describe the new behaviour as a new flow.

## Configuration

`kane-gate.json` at the project root. Only `url` is required.

| Key | Default | What it does |
| --- | --- | --- |
| `url` | (required) | Where the app under test is served. |
| `devCommand` | none | Command that starts the app when `url` isn't answering, as an argv array (`["npm", "run", "dev"]`) or a simple string. Runs without a shell. |
| `readyUrl` / `readyTimeoutSec` | `url` / `60` | What to poll, and for how long, before running flows. |
| `flowsDir` | `kane/flows` | Where `*_test.md` flows live. |
| `flows` | `{}` | Per-flow coverage: `{"browse": {"paths": ["public/index.html", "src/catalog/**"]}}`. Unlisted flows cover every file. |
| `ignore` | `[]` | Extra globs that never count as app changes. |
| `maxAttempts` | `3` | Blocks per prompt before Kane Gate lets Claude stop and asks for a human (1–7). |
| `headless` | `true` | Run Chrome without a window. |
| `parallel` | `2` | Kane workers for `testrun`. |
| `timeoutSec` | `900` | Wall-clock limit for one Kane run. |
| `lockFlows` | `true` | Deny agent edits to flows, config and state. |
| `coverageNudge` | `true` | Ask Claude to add a flow for uncovered changes. |
| `bugDetection` | off | Passed to Kane as `--bug-detection` (`off`, `stop`, `continue`). |
| `kaneBin` | `kane-cli` | The Kane CLI executable. |

## Commands

| In Claude Code | In a terminal | |
| --- | --- | --- |
| `/kane-gate:init` | `kane-gate init` | Config, example flow, `.gitignore`, hook wiring (terminal only), Kane CLI check. |
| `/kane-gate:verify` | `kane-gate run [--all] [--flow name]` | Verify now. Exit code 0 pass, 1 fail, 2 setup problem, so it also works in CI. |
| `/kane-gate:status` | `kane-gate status` | Flows and what they cover, pending changes, gate state, Kane CLI health. |

The hooks call `kane-gate hook <stop|guard|session-start|session-end>`.

## How is this different from the kane-cli skill?

The official [kane-cli skill](https://www.npmjs.com/package/@testmuai/kane-cli-skill) lets an agent run Kane when it decides to, or when you ask. Kane Gate makes verification non-optional. It runs on every stop, picks the flows from the diff, feeds Kane's evidence back as the reason to keep working, locks the tests, and caps the loop. They work well together.

## Try the demo

```bash
git clone https://github.com/KaranSinghBisht/kane-gate && cd kane-gate
npm run demo:setup                  # fresh git copy of the Inkwell shop in ~/inkwell-shop
cd ~/inkwell-shop
claude                              # with the plugin installed, or: claude --plugin-dir <your kane-gate clone>
```

Then ask Claude: *"Add a promo code field to checkout. The payments API already accepts SAVE10 (10% off the subtotal)."*

## How it works

1. **Plan.** Snapshot the working tree (git status plus content hashes), diff it against the last green run, and map the changed files to flows.
2. **Run.** Start the app if needed (`devCommand`, readiness probe), then run `kane-cli testrun run <flows> --agent --headless --parallel N`: one execution, one sealed evidence pack.
3. **Read.** Parse Kane's NDJSON (`testrun_member_end`, each member's `test_md_*` log), open the evidence pack, and pull the failing step's `failure.yaml`, the console and network entries attributed to it, and its annotated screenshot.
4. **Decide.** Pass: record the green baseline and show a receipt. Fail: block the stop with the report, up to `maxAttempts`. Kane couldn't run: warn and step aside.

State lives in `.kane-gate/` (gitignored): `state.json`, `last-report.md`, `history.jsonl`, extracted screenshots and a log.

## Limitations

- The automatic gate needs Claude Code hooks; `kane-gate run` works anywhere, including CI and other agents.
- Desktop web flows. Kane's mobile targets should work through `_test.md` frontmatter but haven't been tested here.
- A flow's first run is authored by Kane's AI. It's slower and uses credits; later runs replay from cache.

## License

[Apache-2.0](LICENSE)
