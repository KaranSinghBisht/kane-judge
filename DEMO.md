# Demo: reproduce the video

The video shows one pre-flight from start to finish, then the checks that keep its scorecard honest. Every step below is a command you can run. Scenes 1 and 2 need a Kane account and use about 500 credits together; scene 3 needs nothing.

## Before you start

```bash
kane-cli whoami            # signed in? (kane-cli login --oauth)
kane-cli balance           # a pre-flight of the sample used about 300 credits in our runs
export KANE_JUDGE_HEADED=1 # show Kane's Chrome windows (omit for headless)
```

Install the plugin once, inside Claude Code:

```text
/plugin marketplace add KaranSinghBisht/kane-judge
/plugin install kane-judge@kane-judge
```

Put Claude Code on the left half of the screen and leave the right half free for Kane's Chrome windows. Any model works; Sonnet is the quickest.

## Scene 1 · Pre-flight: fix it before someone else finds it

You are the team, the night before the deadline. The project is a small shop whose [README](examples/inkwell-shop/README.md) promises browsing, checkout, promo codes and order history. Work on a copy, so the sample stays broken for the next person.

```bash
cp -R <your kane-judge clone>/examples/inkwell-shop ~/my-shop && cd ~/my-shop
git init -q && git add -A && git commit -qm "Inkwell shop"
npm start &      # the shop on http://localhost:4173, no dependencies
claude
```

```text
/kane-judge:preflight . --live http://localhost:4173
```

What happens:

1. **Scan.** Kane itself reads the README (`kane-cli context ingest`) and lists the use-cases it promises, `u1` to `u5`, each with the line it cites. A `FLAG` line quotes a hidden HTML comment addressed to AI judges.
2. **Claims become flows.** Every use-case gets a claim, and Claude writes one plain-English Kane flow per claim under `projects/my-shop/flows/`. Open one: it's just English, and every check says what is *visibly* shown.
3. **Kane runs them**, four at a time, in real Chrome. It browses the shop, adds to the cart, pays with a test card and applies SAVE10. About three minutes.
4. **Results.** Browsing, checkout and payment pass. The promo flow and the order-history flow fail, each with Kane's words, its bug verdict, the console line and a screenshot.
5. **The loop.** Claude opens every screenshot, the passes too.
   - **Promo:** the discount is shown and the Total is gone. The console line from that step names the cause: `[experiments] compact-order-summary: limit-rows removed 1 of 4 rows`. Kane's bug verdict: confirmed product bug.
   - **Order history:** there is no Account menu anywhere. Kane's own triage blames the test; Claude checks the code, finds no such page, and calls it what it is: a promise that was never built.
6. **The fix.** Claude stops the experiment in `data/experiments.json`. Kane re-runs **the same flow, unchanged**, and it passes.
7. **The honest README.** Order history was never built, so the bullet comes out of the README and `kane-judge withdraw` moves that claim's flow out of the run. The hidden comment goes too.
8. **The gate.** Every remaining flow replays as one sealed evidence pack with Kane's self-healing off, and Kane's verdict engine signs it: `Gate: PASS`.
9. Open `projects/my-shop/scorecard.html`. The repaired claim is marked **fixed**, with the change that was made, Kane's record of the same test failing and then passing, and its replay before and after. The coverage table shows what became of every use-case Kane found.

`kane-judge report` would have refused that fix if the flow had been edited between the failing run and the passing one.

**Keep the gate.** The flows are regression tests now:

```bash
kane-judge run projects/my-shop --gate                                             # about half a minute, a few credits
kane-judge run projects/my-shop --start-url https://inkwell-shop.vercel.app --gate # the deployed shop still has the bug: exit 1
```

## Scene 2 · Judge: the same loop on someone else's project

From an empty folder:

```bash
mkdir -p ~/kane-judge-demo && cd ~/kane-judge-demo && claude
```

```text
/kane-judge:judge https://github.com/KaranSinghBisht/kane-judge/tree/main/examples/inkwell-shop --since 2026-11-12 --until 2026-11-19
```

Same scan, same flows, same investigation, against the deployed shop at https://inkwell-shop.vercel.app. This time nothing is fixed: the scorecard reports the promo code and the order history as broken, flags the hidden comment, and lists three questions for the team. Kane's own verdict on the sealed pack is `FAIL: no-failed-flows`.

- Judge more projects into the same folder, then `/kane-judge:board` ranks them by the share of their claims Kane proved.
- For your event's own criteria, copy [`rubrics/kanecli-hackathon.md`](rubrics/kanecli-hackathon.md) (or your own) to `rubric.md` in the folder before you start.

## Scene 3 · Try to cheat it (no account, no credits)

```bash
npx -y github:KaranSinghBisht/kane-judge demo
```

This replays the judge run that is committed in [`examples/judged/inkwell-shop`](examples/judged/inkwell-shop):

1. It re-reads Kane's evidence pack and checks it against the recorded results.
2. If Kane CLI is installed, Kane's own verdict engine judges the pack again. That needs no sign-in.
3. It then doctors the verdict eight ways and runs the same checks `kane-judge report` runs. Each one is refused, with the reason.
4. It opens the scorecard.

To have Kane re-judge the committed pack by hand:

```bash
cd examples/judged/inkwell-shop
kane-cli evidence validate packs/*.evidence
kane-cli evidence verdict packs/*.evidence --policy kane-judge-claims.policy.yaml
```

## Scene 4 · What we found in Kane itself

```bash
cd examples/kane-findings
python3 -m http.server 4399 --directory site &
kane-cli testrun run flows/01-total-shown_test.md flows/02-total-visible_test.md flows/03-no-steps_test.md --agent --headless
```

About two minutes and 50 credits. The numbers, and why one run may not show the first finding, are in [`docs/kane-cli-findings.md`](docs/kane-cli-findings.md).
