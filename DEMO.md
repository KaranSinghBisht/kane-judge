# Demo: both sides of the same check

This script reproduces the demo video. Scene 1 judges a submission. Scene 2 switches sides: you are the team, and pre-flight fixes what the judge found. Each scene is 8 to 10 minutes of real time; the video speeds up the waits.

## Before you start

```bash
kane-cli whoami            # signed in? (kane-cli login --oauth)
kane-cli balance           # the two scenes used about 500 credits together in our runs
export KANE_JUDGE_HEADED=1 # show Kane's Chrome windows (omit for headless)
```

Install the plugin once, inside Claude Code:

```text
/plugin marketplace add KaranSinghBisht/kane-judge
/plugin install kane-judge@kane-judge
```

Put Claude Code on the left half of the screen and leave the right half free for Kane's Chrome windows. Any model works; Sonnet is the quickest.

## Scene 1 · Judge a submission

The submission is a small shop, https://inkwell-shop.vercel.app, with a [README](examples/inkwell-shop/README.md) that claims browsing, checkout, promo codes and order history. Its raw README also hides an HTML comment addressed to AI judges, which a reader of the rendered page never sees.

```bash
mkdir -p ~/kane-judge-demo && cd ~/kane-judge-demo && claude
```

```text
/kane-judge:judge https://github.com/KaranSinghBisht/kane-judge/tree/main/examples/inkwell-shop --since 2026-11-12 --until 2026-11-19
```

What happens:

1. **Scan.** The live demo is found in the README and answers HTTP 200. Every commit falls inside the event window. A `FLAG` line quotes the hidden comment; the judge records it and carries on.
2. **Claims become flows.** Claude writes one plain-English Kane flow per claim under `projects/inkwell-shop/flows/`. Open one: it's just English.
3. **Kane runs them**, four at a time, in real Chrome. It browses the shop, adds to the cart, pays with a test card and applies SAVE10. About three minutes.
4. **Results.** The browsing and checkout flows pass. The promo flow and the order-history flow fail, each with Kane's words, its bug verdict, the console line and a screenshot. The run ends with Kane's own verdict on the sealed evidence pack: `FAIL: no-failed-flows`.
5. **The loop.** Claude opens every screenshot, the passes too.
   - **Promo:** the discount is shown and the Total is gone. The console line from that step names the cause: `[experiments] compact-order-summary: limit-rows removed 1 of 4 rows`. Kane's bug verdict: confirmed product bug. The claim is **broken**.
   - **Order history:** there is no Account menu anywhere, and the README promises one. Kane's bug verdict may blame its own agent here; Claude checks the repo, finds no such page, and marks the claim **broken** (an overclaim).
   - If a failure had been the test's fault, Claude would rewrite *how* the flow gets there and re-run it, at most twice, and the scorecard would show each rewrite.
6. **The scorecard.** Open `projects/inkwell-shop/scorecard.html`. Broken claims come first, each with Kane's screenshot, its Test Manager link, its bug verdict and its own record of the runs. Then the scores, the red flag for the hidden comment, and three questions for the team.

## Scene 2 · Pre-flight: fix it before a judge finds it

Now you are the team, the night before the deadline. Work on a copy, so the sample stays broken for the next judge.

```bash
cp -R <your kane-judge clone>/examples/inkwell-shop ~/my-shop && cd ~/my-shop
npm start &      # the shop on http://localhost:4173, no dependencies
claude
```

```text
/kane-judge:preflight . --live http://localhost:4173
```

What happens:

1. The agent judges your project exactly as in scene 1 and tells you what a judge would have found.
2. **It fixes the promo bug** in your code. Then Kane re-runs **the same flow, unchanged**, and it passes.
3. **It withdraws the order-history claim**: the feature was never built, so the README stops promising it, and `kane-judge withdraw` moves that claim's flow out of the run. (Tell it to build the feature instead, if you'd rather.)
4. **It removes the hidden comment** addressed to AI judges.
5. **Final gate.** Every remaining flow replays as one sealed evidence pack, in about half a minute, and Kane's verdict engine signs it: `Gate: PASS`.
6. Open `projects/my-shop/scorecard.html`. The repaired claim is marked **fixed**, with the change that was made, Kane's record of the same test failing and then passing, and its screenshot before and after.

`kane-judge report` would have refused that fix if the flow had been edited between the failing run and the passing one.

## Scene 3 · A whole event

- Judge more projects into the same folder, then `/kane-judge:board` ranks them in `SCOREBOARD.md` and `scoreboard.html`.
- For your event's own criteria, put them in a `rubric.md` in the folder before you start.

## No Claude Code?

The run behind the README's scorecard is committed. Rebuild the scorecard from it, or re-run its flows with your own Kane account:

```bash
node dist/kane-judge.mjs report examples/judged/inkwell-shop
node dist/kane-judge.mjs run examples/judged/inkwell-shop
```
