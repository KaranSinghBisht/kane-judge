# MyPillPal · Kane proved 4 of 9 claims

**Kane proved 4 of 9 claims · 2 unverifiable · 3 untested** · rubric 72% (36/50, the agent's judgement)

[Live demo](https://mypillpal.vercel.app/) · [Repo](https://github.com/Jaden300/MyPillPal)

A polished, account-free four-screen questionnaire that really computes a transparent additive risk score, shows what contributed, charts regional resistance and builds a personalised doctor-question list. The core loop is proven in the live demo. The one overclaim: figures are not always shown with their source and year. For 12 of 17 regions \(the 'national estimate' states and every WHO region\) the results screen shows only 'National estimate, not local data'.

## Claims
- ⚠️ **Resistance data is shown with its source and year** (unverifiable). Kane passed this check three times, but each final screenshot contradicts it. For California the only label under the chart is 'NATIONAL ESTIMATE, NOT LOCAL DATA', with no source name and no year. src/components/SourceChip.jsx renders only that label whenever scope is 'estimate', and that covers 6 US states and all 6 WHO regions \(12 of 17\). Source and year do appear for the locally sourced regions \(e.g. 'Washington State Department of Health antibiogram program 2024', c1\). Kane's pass is contradicted, so the claim isn't proven. As written it is false for most regions.
  - Source: README: "Data comes from published annual surveillance reports, shown with their source and year."
  - Kane flow `05-source-and-year`: passed after 3 run(s) · screenshot `evidence/05-source-and-year-run3-passed.jpg` · https://test-manager.lambdatest.com/projects/01M7N9RJ1E69X9FGMH47KHRS40/test-cases/01M89HA4XQ3ZJZ0ZBVGF49FMX7/dashboard/share/US_AWW5DZOGWERBW0LU6I8XGGX7X0EM1VT5BHUYTGWWU8SPJ34DO7FF6UC8Z5DHBMOI?type=summary&agentView=true&fqdn=summary-page
  - Kane's record (UTC): ✓ 14:24 → ✓ 14:28 (flow rewritten, same checks) → ✓ 14:31 (flow rewritten, same checks)
  - Round 1: Kane: passed \(pneumonia, California\); the screenshot showed the chart with 'US AVG' markers and no source label → TEST\_WRONG: rewrote the step to scroll to the label under the chart. Check unchanged
  - Round 2: Kane: passed; the screenshot showed only 'NATIONAL ESTIMATE, NOT LOCAL DATA' \(no source, no year\) → Pass contradicted by the screenshot. Read SourceChip.jsx: estimate scope drops source and year. Rewrote \(2 of 2\) to name California and require displayed text only. Check unchanged
  - Round 3: Kane: passed again; the screenshot again shows only 'NATIONAL ESTIMATE, NOT LOCAL DATA' → Not proven: Kane's pass is contradicted by its own screenshot and by the code. Marked unverifiable: rewrite budget spent, and a passing run can't be recorded as broken
- ⚠️ **No backend: no accounts, no tracking, answers processed in the browser** (unverifiable). No account was needed \(c1\), and the app shows a 'Nothing leaves this device' badge, but these flows didn't audit network traffic for analytics calls. README lists the stack as a static Vite build.
  - Source: README: "There is no backend. No accounts, no tracking, no analytics on health information."
- ✅ **Four screens, no account: pick an infection, check risk factors, pick a region, and get a profile with a risk tier and plain language explanation, resistance rates with sources, questions to ask your doctor, and what you can do** (proven). Kane went UTI → recent antibiotics → Washington → results with no login. The final screenshot shows the Washington resistance chart labelled 'Washington State Department of Health antibiogram program 2024, local antibiogram' and Section C question 1 \('I took antibiotics within the past 3 months…'\). Run 1's screenshots show 'Moderate risk' with its plain-language explanation and the 'What you can do' tiles. A named source shows only for locally sourced regions \(see c6\).
  - Source: README: "Four screens, under two minutes, no account" and "Get your profile. A risk tier with a plain language explanation, the resistance rates for your infection in your area with sources, a personalized list of questions to ask your doctor, and what you can do."
  - Kane flow `01-full-profile`: passed after 2 run(s) · screenshot `evidence/01-full-profile-run2-passed.jpg` · https://test-manager.lambdatest.com/projects/01M7N9RJ1E69X9FGMH47KHRS40/test-cases/01M89H7K34FJAP5WHPGXM0BDBW/dashboard/share/US_2E4GWSWGMNNYCOO8LVJN101FUCBE3QWEY9CV6TGJSRV7W4WRI5Z6AC0AP3NVOWPL?type=summary&agentView=true&fqdn=summary-page (earlier run)
  - Kane's record (UTC): ✓ 14:24 → ✓ 14:28 (flow rewritten, same checks)
  - Round 1: Kane: passed \(UTI, first region California\); final screenshot showed only the 'What you can do' tiles → TEST\_WRONG: the pass wasn't fully backed by its screenshot; rewrote the navigation to stop at the source label and Section C. Checks unchanged
  - Round 2: Kane: passed: screenshot shows the source chip and the first doctor question → proven
- ✅ **Five common infection types to pick from: UTI, cold or sore throat, pneumonia, skin infection, ear or sinus infection** (proven). The final screenshot shows all five cards: 'Urinary tract infection \(UTI\)', 'Cold, flu, or sore throat', 'Pneumonia', 'Skin infection', 'Ear or sinus infection'.
  - Source: README: "Pick your infection type. Five common ones: UTI, cold or sore throat, pneumonia, skin infection, ear or sinus infection."
  - Kane flow `02-five-infections`: passed after 2 run(s) · screenshot `evidence/02-five-infections-run2-passed.jpg` · https://test-manager.lambdatest.com/projects/01M7N9RJ1E69X9FGMH47KHRS40/test-cases/01M89H7KA0ZWWNRN5KW2JYHCXV/dashboard/share/US_4HZ9L22KMWHJM003GBWF7YLVR3SSHA85J3M3QDNHZTT7EV1NY4GZ74NNJT5EJ54N?type=summary&agentView=true&fqdn=summary-page
  - Kane's record (UTC): ✓ 14:24 → ✓ 14:28 (flow rewritten, same checks)
  - Round 1: Kane: passed; the screenshot showed only four cards \(the fifth was below the fold\) → TEST\_WRONG: rewrote the step to scroll all five cards on screen. Check unchanged
  - Round 2: Kane: passed: all five cards visible → proven
- ✅ **Each risk factor explains why it matters** (proven). The final screenshot shows expanded 'Why this matters' panels for diabetes \(with the 36% vs 21% figure\), hospitalization and international travel. Every other factor has a 'Why this matters' link, and the c5 screenshots show the recent-antibiotics explanation.
  - Source: README: "Check your risk factors. Recent antibiotic use, diabetes, recent hospitalization, international travel, age, and more. Each one explains why it matters."
  - Kane flow `03-risk-factor-explanations`: passed after 1 run(s) · screenshot `evidence/03-risk-factor-explanations-run1-passed.jpg` · https://test-manager.lambdatest.com/projects/01M7N9RJ1E69X9FGMH47KHRS40/test-cases/01M89H7M19ZW9322KSFSGCWHPE/dashboard/share/US_TKTWNOWJUZSI4BRU2BKLCLT5TY5M02ZSI543M5TLDQGIG6T6U7USDMC3OJHF43NK?type=summary&agentView=true&fqdn=summary-page
  - Kane's record (UTC): ✓ 14:24
  - Round 1: Kane: passed: 'Why this matters' explanations expanded on the About you screen → proven
- ✅ **The app shows you which of your answers contributed to your score** (proven). With recent antibiotics and diabetes ticked, the results show 5 of 16, 'Moderate risk', '2 factors ticked', and a 'What contributed' list: 'You have taken antibiotics in the past 3 months +3' and 'You have diabetes +2'.
  - Source: README: "the app shows you which of your answers contributed to your score."
  - Kane flow `04-score-contributions`: passed after 3 run(s) · screenshot `evidence/04-score-contributions-run3-passed.jpg` · https://test-manager.lambdatest.com/projects/01M7N9RJ1E69X9FGMH47KHRS40/test-cases/01M89H7KPQYE8X07RCHHRKE43R/dashboard/share/US_7F475W8HUWYBH3EYXDNK4XFR9WIZ3JK1T4UTGQD303QQ2UJ3SJSXQA8XNPTS59IM?type=summary&agentView=true&fqdn=summary-page
  - Kane's record (UTC): ✗ 14:24 → ✓ 14:28 (flow rewritten, checks changed) → ✓ 14:35 (flow rewritten, checks changed)
  - Round 1: Kane: failed at step 3: only recent antibiotic use listed; the Running Score showed '1 factor ticked' before Continue \(test\_data\_issue, 0.94\) → TEST\_WRONG: Kane's diabetes click never registered. The score was consistent with one tick, so the app wasn't at fault. Rewrote step 1 to click the checkbox itself and confirm '2 factors ticked'. Final check unchanged
  - Round 2: Kane: passed: both contributions listed, +3 and +2 → The report refused it: the rewrite's 'confirm…' wording counted as a changed check. Reworded it as an action \(rewrite 2 of 2\)
  - Round 3: Kane: passed: 5 of 16, '2 factors ticked', 'You have taken antibiotics in the past 3 months +3' and 'You have diabetes +2' → proven
- ▫️ **The four screens take under two minutes** (untested). Not measured: Kane's 155s for the c1 flow includes AI driver overhead, so it says nothing about a human's time. A person clicking through looked plausible at well under two minutes, but no measured interval exists.
  - Source: README: "Four screens, under two minutes, no account"
- ▫️ **Every risk-model weight traces to a published study** (untested). A browser can't verify citations. The 'Why this matters' panels quote study figures \(e.g. 36% vs 21% for diabetes\), but the papers behind each weight aren't linked in the UI. Left as a question.
  - Source: README: "Every weight traces to a published study"
- ▫️ **It never tells you to take or avoid any drug** (untested). Out of budget: needs a review of copy across all infection/region combinations. The screens Kane saw use framing like 'Read this as background, not as a menu to choose from', and the doctor questions ask rather than instruct.
  - Source: README: "Not a prescribing tool. It never tells you to take or avoid any drug."

## Coverage: everything the README promises

Kane found 1 use-case\(s\) in the README: 1 tested by a Kane flow, 0 not. The list is Kane's own reading of the README (`kane-cli context ingest`).

- u1 Prepare for an antibiotic conversation with a doctor (README L7-L9): c1 proven, c2 untested, c3 proven, c4 proven, c5 proven, c6 unverifiable, c7 untested, c8 unverifiable, c9 untested

## Suggested scores

_The agent's judgement, for a human judge to adjust._

- **Works** 8/10: c1, c3, c4 and c5 proven in the live demo, with no console errors at any failing step. Only the TEST\_WRONG c5 run failed. c6's pass is contradicted by its screenshot for estimate regions.
- **Substance** 7/10: c5 proven: a real additive score \(5 of 16 for two factors\) with per-factor weights. c1 proven: the doctor questions are personalised to answers \('I took antibiotics within the past 3 months…'\). Data is static JSON by design; nothing is computed server-side.
- **Truthfulness** 6/10: c1, c3, c4 and c5 match the README. c6 overstates: 12 of 17 regions show no source or year on screen. The app does flag estimates loudly instead of passing them off as local data. c7 and c8 untested or unverifiable.
- **Craft** 8/10: c1–c5 screenshots show a clean, coherent four-step UI with a live running score, progress bar, disclaimers and clear sections A–D. Kane logged no console errors.
- **Originality** 7/10: c1 and c5 show a fresh angle: it turns antibiograms into patient-facing conversation prompts with a transparent score, not a symptom checker.

## Red flags
- Claim contradicted by code: src/components/SourceChip.jsx omits the source and year for 'estimate' regions \(12 of 17\), against the README's 'shown with their source and year'. Kane's AI passed this check three times while each screenshot showed no source; the pass was rejected on screenshot evidence.
- No scan red flags. The repo was created 2026-09-06 with 7 commits through 2026-09-10 by one author; no event window was given to check against.

## Questions to ask the team
1. The README says figures are 'shown with their source and year', but for California \(and every estimate region, including all WHO regions\) the results show only 'National estimate, not local data' \(SourceChip.jsx drops source and year when scope is 'estimate'\). Was that intentional, and does the printable summary carry the source line instead?
2. The Washington, Minnesota, Colorado and New York rates \(e.g. WA TMP-SMX 28%, NY 34%\) are cited to state antibiogram programs for 2024. Can you point to the exact reports and tables those numbers came from?
3. Recent antibiotic use adds +3 and diabetes +2, with tiers at 3 and 6. Which studies set each weight and the tier cut-offs, and has anyone clinical reviewed the thresholds?

_4 proven · 0 broken · 2 unverifiable · 3 untested. Judged by Kane Judge with evidence from Kane CLI; first-round triage for human judges._
