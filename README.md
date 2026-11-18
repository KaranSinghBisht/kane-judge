# Kane Judge

**Judge hackathon projects by using them, not by reading about them. Then run the same judge on your own project, and let it fix what it finds.**

Kane Judge is a Claude Code plugin built on [Kane CLI](https://github.com/LambdaTest/kane-cli). Give it a submission. Claude reads what the team claims, and each claim becomes a plain-English Kane test that runs against the **live demo in real Chrome**. Every failure is investigated: is the product broken, was my test wrong, or am I just blocked? The result is a scorecard where every verdict points at Kane's evidence.

It has two modes:

- **Judge** someone else's project. The agent may fix its own tests, never their product.
- **Pre-flight** your own project before you submit. Same claims, same tests, but now the agent fixes your code (or corrects your README) and Kane must pass the *same test* before the fix counts.

<p>
  <a href="docs/sample-report.md"><img src="docs/scorecard.png" width="49%" alt="Judge mode: a scorecard for the sample submission. Kane's verdict on the sealed evidence pack is FAIL, and the first broken claim shows Kane's bug verdict and its screenshot of an order summary with no Total."></a>
  <a href="docs/sample-preflight-report.md"><img src="docs/preflight.png" width="49%" alt="Pre-flight mode: the same project after the agent fixed it. Kane's verdict is PASS, and the fixed claim shows the change and Kane's screenshots of the same test before and after."></a>
</p>

*Two real scorecards for the sample submission, [`examples/inkwell-shop`](examples/inkwell-shop). Left, **judge**: Kane proved 2 of 4 claims and caught a Total that disappears ([report](docs/sample-report.md), [HTML](docs/sample-scorecard.html)). Right, **pre-flight**: the agent fixed the bug and Kane passed the same test ([report](docs/sample-preflight-report.md), [HTML](docs/sample-preflight-scorecard.html)). The judge run is committed in [`examples/judged/inkwell-shop`](examples/judged/inkwell-shop): flows, Kane's results, screenshots and the verdict.*

## Try it in one paste

You need Node 20+, Google Chrome, Claude Code 2.1.91 or later, and a free [TestMu AI](https://www.testmuai.com/kane-cli/) account for Kane CLI (new accounts get 10,000 credits).

```bash
npm install -g @testmuai/kane-cli
kane-cli login --oauth
```

In Claude Code, from an empty folder:

```text
/plugin marketplace add KaranSinghBisht/kane-judge
/plugin install kane-judge@kane-judge
/kane-judge:judge https://github.com/KaranSinghBisht/kane-judge/tree/main/examples/inkwell-shop
```

That judges the sample submission, a small shop deployed at https://inkwell-shop.vercel.app. It takes about 10 minutes and roughly 250 Kane credits. Start Claude Code with `KANE_JUDGE_HEADED=1 claude` to watch Kane drive Chrome.

**No Claude Code?** The Kane half runs without it:

```bash
git clone https://github.com/KaranSinghBisht/kane-judge && cd kane-judge
node dist/kane-judge.mjs report examples/judged/inkwell-shop   # rebuild the scorecard from the committed run: no credits
node dist/kane-judge.mjs run examples/judged/inkwell-shop      # re-run the four claim flows with your own Kane account
```

`report` checks the committed verdict against whatever Kane just found, so if your run disagrees with ours, it says so instead of printing our scorecard.

## How it works

```text
 submission page / GitHub repo or folder / local folder
          │  kane-judge scan      reads only: README, commits against the event window,
          ▼                       live demo link, text aimed at AI judges
 Claude picks the 3–5 claims that matter ──► one Kane flow per claim (plain English)
          │  kane-judge run       Kane CLI drives real Chrome; one sealed evidence pack per run;
          ▼                       Kane's verdict engine judges the pack against a policy
 Kane's evidence ──► Claude investigates every ✗
          │
          ├─ TEST_WRONG  ──► rewrite how the flow reaches the feature (never what it checks) ──► run again
          ├─ BLOCKED     ──► the claim is unverifiable, never broken
          └─ APP_BROKEN  ──► judge:      the claim is broken
                             pre-flight: fix the code or the README ──► Kane runs the same flow again
          ▼  kane-judge report / board
 scorecard.html · report.md · leaderboard
```

## Judge

```text
/kane-judge:judge https://github.com/team/repo --since 2026-11-12 --until 2026-11-19
/kane-judge:judge https://devpost.com/software/some-project https://github.com/team/repo --live https://their-demo.vercel.app
/kane-judge:board
```

Give it a submission page, a GitHub repo, a folder inside a repo (`…/tree/main/apps/web`) or a local folder. The live demo is found on the submission page, in the repo's homepage field or in the README; pass `--live` when there is more than one candidate. Some submission pages, like Devpost's, sit behind bot protection. The scan says so, and the judge works from the repo and the demo.

Each project gets `projects/<slug>/` with the scan, the flows, Kane's results, screenshots, `verdict.json`, `scorecard.html` and `report.md`. `/kane-judge:board` ranks every judged project in `SCOREBOARD.md` and `scoreboard.html`.

**Your event's own criteria:** put them in a `rubric.md` in the event folder. Otherwise the [default rubric](skills/judging/SKILL.md#default-rubric) scores Works, Substance, Truthfulness, Craft and Originality.

## Pre-flight

Run it from your project folder, with your app running:

```text
/kane-judge:preflight . --live http://localhost:3000
```

The agent judges your project the way a judge would, tells you what they would have found, and then closes the loop:

1. For each claim Kane showed broken, it fixes the code. If the feature was never built, it corrects the README instead and withdraws the claim.
2. Kane re-runs **the same flow, unchanged**. The fix counts only if that run passes.
3. A final run replays every flow as one sealed evidence pack, and Kane's verdict engine signs it: `Gate: PASS`.

Write `check only` after the command to get the findings without any changes. After you redeploy, `kane-judge run projects/<slug> --start-url https://your-app.example.app --gate` replays the same flows against the deployed build.

On the sample shop this took 10 minutes and about 250 Kane credits, and the final gate replayed in half a minute ([the scorecard](docs/sample-preflight-report.md)). Replayed with `--start-url` against the deployed shop, which we keep broken, the same promo flow fails again and the gate exits 1.

Try it on the sample (it has no dependencies):

```bash
git clone https://github.com/KaranSinghBisht/kane-judge
cp -R kane-judge/examples/inkwell-shop my-shop && cd my-shop
npm start &     # http://localhost:4173
claude          # then: /kane-judge:preflight . --live http://localhost:4173
```

## What it catches

The sample submission in [`examples/inkwell-shop`](examples/inkwell-shop) holds one of each:

- **A bug you find by using the app.** A client-side A/B experiment trims the order summary to three rows. Once a promo code adds a Discount row, the **Total** is removed from the page. The pricing API returns the right numbers and no single file looks wrong; the two only meet in the browser. Kane's console capture from the failing step names the experiment.
- **An overclaim.** The README promises order history under Account → Orders. Kane looks where a user would look and finds no Account entry. Kane's own bug verdict blames its agent for that; the judge overrules it, because the repo has no such page and orders are never stored.
- **Text aimed at AI judges.** A hidden HTML comment in the README tells AI judges the project is already approved and should get full marks without the demo being checked. Kane Judge reports it and judges the project anyway. The same check runs on what a demo prints to the console while Kane uses it.
- **The facts a judge needs.** When the repo was created, how many commits landed before, during and after the event window, and who wrote them.

**On real submissions.** We ran it on two 2026 hackathon winners taken from public Devpost galleries:
- Kane proved 7 of their 10 claims in the live demos.
- One claim wasn't backed by the demo: the README promised a source and year for every figure, and most regions showed neither.
- Two game mechanics were marked *unverifiable* rather than broken when Kane couldn't play them (keys that must be held down, tower placement).
- The judge overrode Kane's own triage twice, each time citing Kane's screenshot as the evidence.

## How the verdict stays honest

These rules are enforced in code by `kane-judge report`, not just written in the agent's instructions:

- **Proven needs a real pass.** A claim is *proven* only when its Kane flow's latest run passed and actually ran steps. A flow with no start URL, no `## ` steps or no check is refused before it runs, because Kane reports such a flow as passed without doing anything ([findings](docs/kane-cli-findings.md)).
- **Broken needs a failure.** A claim is *broken* only when its Kane flow's latest run failed. A flow the judge got wrong is rewritten, not counted against the project.
- **Two rewrites, then stop.** Every run records a hash of the flow's text. A claim proven by a flow that was rewritten more than twice is refused; it has to be reported as unverifiable.
- **A fix is the same test going from red to green.** In pre-flight, a fix is accepted only when Kane ran the same flow text before and after: failed, then passed.
- **A judge can't fix.** `fix` and `withdrawn` are rejected outside pre-flight mode.
- **Kane's record, not the agent's story.** Next to the agent's notes, each claim shows the run history taken from Kane's results: `✗ 20:25 → ✗ 20:32 (flow rewritten) → ✓ 20:35`.
- **No walking away.** A Stop hook keeps the agent from ending its turn while Kane's latest results aren't in a scorecard that passed these checks. It asks once, and lets the agent stop if it says what is still open.

And by the agent's instructions:

- **A pass has to match the screenshot.** Kane Judge saves the final screen of every passing flow, and the agent opens it before it calls a claim proven. Kane can pass a check on text that is in the page but not displayed, so a pass the screenshot doesn't back is treated as a wrong test and rewritten.
- **Blocked isn't broken.** Login walls without demo credentials, wallets, payments and captchas make a claim *unverifiable*.
- **Untrusted input stays data.** Pages, READMEs, code and console output never instruct the judge.
- **Nothing runs but the browser.** Kane Judge never installs, builds or executes a judged project's code. Flows use obvious test data and avoid anything irreversible.

## How it uses Kane CLI

| Kane CLI | What Kane Judge does with it |
| --- | --- |
| `_test.md` flows | One per claim, in plain English. Kane's AI authors the steps on the first run; later runs replay and self-heal. |
| `kane-cli testrun run --agent` | One execution per round, four flows at a time. The NDJSON stream and each member's event log give the failing step and Kane's own words. |
| Sealed evidence pack | The failing step's `failure.yaml`, the console and network entries of that step, and the step screenshots. |
| Kane's bug verdict and triage | For every failure Kane says whether it confirmed a product bug, with a category, severity and confidence. The scorecard shows it. Kane judges the test against the app; the judge uses that as a lead while it judges the app against the claim, and may overrule it with Kane's own screenshot. |
| `kane-cli evidence verdict` | After every run, Kane's own verdict engine judges the sealed pack against [`policies/claims.yaml`](policies/claims.yaml): no failed flows, no flow without checks, nothing flaky. The scorecard shows Kane's verdict and the pack's hash. It runs locally and costs no credits. |
| `--override-start-url` | `kane-judge run --start-url <url>` replays the same flows against another build: a local fix first, then the deployed demo. |
| Test Manager share links | One per claim, so a human judge can replay what Kane did. |

## What we found in Kane CLI

Building a judge on a test runner means distrusting its passes. Two of them turned out to be false in Kane CLI 0.10.5, and both reproduce in about two minutes from [`examples/kane-findings`](examples/kane-findings):

- `kane-cli testrun run` reports a `_test.md` with no `## ` steps as **passed** (exit 0, `totals.passed: 1`), having run nothing.
- A check such as "Verify the Order summary shows a Total row" **passes** when that row is hidden with `display:none`, against the screenshot Kane saved for the same step.

The write-up, and what Kane Judge does about each, is in [`docs/kane-cli-findings.md`](docs/kane-cli-findings.md).

## The CLI

The plugin puts a small bundled CLI on Claude Code's PATH. You can also install it by itself: `npm install -g github:KaranSinghBisht/kane-judge`.

| Command | What it does |
| --- | --- |
| `kane-judge scan <url-or-folder>... [--live <url>] [--since <date> --until <date>]` | Reads the submission into `projects/<slug>/`: page text, README, repo facts, live demo status, injection hints. A plain date covers that whole day in every timezone; pass a full timestamp for an exact deadline. |
| `kane-judge run <project> [--only <flow>] [--start-url <url>] [--gate] [--headed]` | Runs the project's Kane flows and extracts the evidence. `--gate` exits 1 unless every flow passed and Kane's verdict is a pass. |
| `kane-judge withdraw <project> <flow>` | Pre-flight: moves a withdrawn claim's flow out of `flows/`, so later runs leave it out. |
| `kane-judge report <project>` | Checks `verdict.json` against Kane's results and writes `scorecard.html` and `report.md`. |
| `kane-judge board [<folder>]` | Ranks every judged project. |
| `kane-judge source <repo-url> [path...]` | Lists a GitHub repo's files or prints some, read-only, so a verdict can cite the code behind a failure without cloning or running anything. |
| `kane-judge doctor` | Checks Kane CLI sign-in, Chrome and the GitHub CLI. |

Because `run --gate` sets the exit code, the flows a pre-flight leaves in `projects/<slug>/flows/` work as a pre-push or CI check once Kane is signed in there (`kane-cli login --username … --access-key …`):

```bash
kane-judge run projects/my-app --start-url "$PREVIEW_URL" --gate
```

## Limits

- Web demos on desktop Chrome. A CLI, library or plugin has nothing for Kane to use, so its claims come back *unverifiable*, with the repo facts and questions for the team. Kane's mobile targets fit the same model but aren't wired up.
- A flow's first run is authored by Kane's AI, which takes a minute or two and about 50 credits; replays take seconds and cost almost nothing. Judging the sample took 8 to 12 minutes and 200 to 270 credits in our runs. A real project with three investigation rounds cost about 640, and a browser game that needed several rewrites about 1,350.
- The claim verdicts are bound to Kane's evidence. The rubric scores are Claude's judgment and can move a few points between runs.
- Scores are a first-round triage for human judges, not a final decision.

## Credits

The idea of an AI hackathon judge as a Claude Code skill comes from Austin Griffith's [ethglobal-judge](https://github.com/austintgriffith/ethglobal-judge), which reads the repo, the git history and onchain state, and by design never runs the project. Kane Judge adds the step it leaves out: using the demo.

## License

[Apache-2.0](LICENSE)
