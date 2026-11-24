import type { KanePolicyVerdict } from "../kane/policy.js";
import { isPrivateHost } from "../scan/page.js";
import type { ScanResult } from "../scan/types.js";
import { demoInjectionHints } from "./demo-hints.js";
import { badge, escapeHtml, link, page, safeHref, scoreRow, shotFigure, type ReplayFrame } from "./html.js";
import type { PackCheck } from "./pack-verify.js";
import { claimRuns, fixProof, resultsStamp, type FlowResult, type FlowRunEntry, type KaneResults, type ReplayStep, type RunRecord } from "./results.js";
import { CLAIM_STATUSES, type ClaimStatus, type Verdict, type VerdictClaim } from "./verdict.js";

/** The <meta> tag in which a scorecard records the Kane runs it was built from (see `resultsStamp`). */
export const RESULTS_META = "kane-judge-results";

export interface ScorecardInput {
  verdict: Verdict;
  results?: KaneResults;
  scan?: ScanResult;
  /** Project-relative screenshot path -> data URI. */
  images: Map<string, string>;
  /** What re-reading Kane's sealed evidence packs found when the report was built. */
  packs?: PackCheck;
}

export function overall(verdict: Verdict): { score: number; max: number; pct: number } {
  const score = verdict.scores.reduce((s, x) => s + x.score, 0);
  const max = verdict.scores.reduce((s, x) => s + x.max, 0);
  return { score, max, pct: max > 0 ? Math.round((score / max) * 100) : 0 };
}

export function claimCounts(verdict: Verdict): Record<ClaimStatus, number> {
  const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
  for (const claim of verdict.claims) counts[claim.status] += 1;
  return counts;
}

/** What a reader sees on the badge: "fixed" for a claim a pre-flight repaired, the status otherwise. */
export function claimLabel(claim: VerdictClaim): string {
  return claim.status === "proven" && claim.fix ? "fixed" : claim.status;
}

const READING_ORDER = ["broken", "fixed", "unverifiable", "proven", "untested", "withdrawn"];

/** Findings first: what a reader has to look at comes before what simply worked. */
export function claimsInReadingOrder(verdict: Verdict): VerdictClaim[] {
  const rank = (claim: VerdictClaim) => READING_ORDER.indexOf(claimLabel(claim));
  return verdict.claims
    .map((claim, i) => ({ claim, i }))
    .sort((a, b) => rank(a.claim) - rank(b.claim) || a.i - b.i)
    .map((x) => x.claim);
}

/** "Kane proved 3 of 5 claims · 1 broken · 1 unverifiable" */
export function headline(verdict: Verdict): string {
  const c = claimCounts(verdict);
  const fixed = verdict.claims.filter((claim) => claimLabel(claim) === "fixed").length;
  const rest = [
    fixed && `${fixed} fixed in pre-flight`,
    c.broken && `${c.broken} broken`,
    c.unverifiable && `${c.unverifiable} unverifiable`,
    c.untested && `${c.untested} untested`,
    c.withdrawn && `${c.withdrawn} withdrawn`,
  ].filter(Boolean);
  return [`Kane proved ${c.proven} of ${verdict.claims.length} claims`, ...rest].join(" · ");
}

const stemOf = (flowPath: string) => flowPath.replace(/^flows\//, "").replace(/_test\.md$/, "");

/** The Kane result behind a claim (flows/02-promo_test.md -> results.flows["02-promo"]). */
export function flowFor(claim: VerdictClaim, results?: KaneResults): FlowResult | undefined {
  if (!claim.flow || !results) return undefined;
  return results.flows[stemOf(claim.flow)];
}

/**
 * Kane's verdict on the latest run, when that run covered every flow behind
 * the claims. Only then does one sealed evidence pack speak for the whole scorecard.
 */
export function kaneSignOff(verdict: Verdict, results?: KaneResults): { run: RunRecord; kane: KanePolicyVerdict } | undefined {
  const runs = results?.runs ?? [];
  const last = runs[runs.length - 1];
  if (!last?.kaneVerdict) return undefined;
  const ran = new Set(last.flows.map(stemOf));
  const needed = verdict.claims.filter((c) => c.flow && c.status !== "withdrawn").map((c) => stemOf(c.flow ?? ""));
  if (needed.length === 0 || !needed.every((flow) => ran.has(flow))) return undefined;
  return { run: last, kane: last.kaneVerdict };
}

/** "FAIL: no-failed-flows" / "PASS" */
function verdictWord(kane: KanePolicyVerdict): string {
  const failed = [...kane.failedGates, ...kane.erroredGates];
  return `${kane.result.toUpperCase()}${failed.length ? `: ${failed.join(", ")}` : ""}`;
}

const clock = (iso: string) => iso.slice(11, 16);

/** Says when the flow's text changed since the run before, and whether what it checks changed with it. */
function rewriteNote(before: FlowRunEntry | undefined, run: FlowRunEntry): string {
  if (!before?.flowSha || !run.flowSha || before.flowSha === run.flowSha) return "";
  if (!before.checksSha || !run.checksSha) return " (flow rewritten)";
  return before.checksSha === run.checksSha ? " (flow rewritten, same checks)" : " (flow rewritten, checks changed)";
}

/**
 * Kane's own record of the runs behind a claim: "✗ 20:25 → ✗ 20:32 (flow rewritten, same checks) → ✓ 20:35".
 * Built from run results and flow hashes, never from the judge's notes. With `results`,
 * it covers every flow that carried the claim, so renaming a flow file hides nothing.
 */
export function runTrail(flow: FlowResult, results?: KaneResults): string {
  const history: FlowRunEntry[] = results ? claimRuns(results, flow) : (flow.history ?? []);
  return history.map((run, i) => `${run.status === "passed" ? "✓" : "✗"} ${clock(run.at)}${rewriteNote(history[i - 1], run)}`).join(" → ");
}

/** The Test Manager link of the latest run, or of the most recent earlier run that has one. */
export function shareLink(flow: FlowResult): { url: string; latest: boolean } | undefined {
  if (flow.shareUrl) return { url: flow.shareUrl, latest: true };
  const earlier = [...(flow.history ?? [])].reverse().find((run) => run.shareUrl);
  return earlier?.shareUrl ? { url: earlier.shareUrl, latest: false } : undefined;
}

/** Every red flag the scorecard shows: the judge's own, plus what the scan and the demo's own output tripped. */
export function allFlags(input: Pick<ScorecardInput, "verdict" | "scan" | "results">): string[] {
  const automatic = [...(input.scan?.injectionHints ?? []), ...demoInjectionHints(Object.values(input.results?.flows ?? {}))];
  return [...new Set([...input.verdict.flags, ...automatic.map((h) => `Possible prompt injection aimed at AI judges (automatic scan): ${h}`)])];
}

function fixBlock(claim: VerdictClaim, flow: FlowResult | undefined, results: KaneResults | undefined): string {
  if (!claim.fix) return "";
  const lead = claim.status === "withdrawn" ? "Claim withdrawn." : claim.status === "proven" ? "Fixed in pre-flight." : "Fix attempted; Kane still fails it.";
  const files = claim.fix.files.length ? ` <span class="muted">Changed: ${claim.fix.files.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}</span>` : "";
  const proof = flow && results && claim.status === "proven" ? fixProof(results, flow) : undefined;
  const proofLine = proof ? `<div class="muted">Kane ran the same test before and after: failed at ${escapeHtml(clock(proof.failedAt))}, passed at ${escapeHtml(clock(proof.passedAt))} UTC.</div>` : "";
  return `<div class="fix"><b>${lead}</b> ${escapeHtml(claim.fix.summary)}${files}${proofLine}</div>`;
}

/** Kane's own bug verdict, shown while the flow's latest run is the failing one. */
function bugLine(flow?: FlowResult): string {
  const bug = flow?.status !== "passed" ? flow?.failure?.bugVerdict : undefined;
  if (!bug) return "";
  const detail = [bug.category, bug.severity, bug.confidence !== undefined ? `confidence ${bug.confidence}` : undefined].filter(Boolean).join(", ");
  const lead = bug.confirmed ? "Kane's bug verdict: confirmed product bug." : "Kane's bug verdict: not a product bug (it blames the test or its own run).";
  return `<div class="kane-bug ${bug.confirmed ? "yes" : "no"}"><b>${lead}</b>${bug.title ? ` ${escapeHtml(bug.title)}` : ""}${detail ? ` <span class="muted">(${escapeHtml(detail)})</span>` : ""}</div>`;
}

/** Screenshots a claim's card needs: the latest one, plus the failing "before" of a fix. */
export function claimShots(claim: VerdictClaim, results?: KaneResults): string[] {
  const flow = flowFor(claim, results);
  if (!flow) return [];
  const proof = results && claim.fix && claim.status === "proven" ? fixProof(results, flow) : undefined;
  return [proof?.failedShot, flow.screenshot].filter((s): s is string => !!s);
}

/** The step screenshots a claim's replays need, one list per replay (the "before" of a fix, then the latest run). */
export function claimReplays(claim: VerdictClaim, results?: KaneResults): string[][] {
  const flow = flowFor(claim, results);
  if (!flow) return [];
  const proof = results && claim.fix && claim.status === "proven" ? fixProof(results, flow) : undefined;
  return [proof?.failedFrames, flow.frames].filter((f): f is ReplayStep[] => !!f && f.length > 1).map((f) => f.map((step) => step.file));
}

/** Kane's line for a step, without its internal call syntax: `analyze: ANALYZE(visual, 'x…')` -> `analyze: x…`. */
export function stepCaption(step: ReplayStep, failure?: string): string {
  if (step.status === "failed" && failure) return `failed: ${failure}`;
  const raw = step.summary ?? step.kind ?? "step";
  return raw
    .replace(/ANALYZE\([a-z_]+,\s*'?/i, "")
    .replace(/\s*\|\s*HINTS:.*$/i, "")
    .replace(/'?\)?\s*$/, "")
    .trim();
}

/** A run's steps as replay frames, or nothing unless every one of its screenshots was loaded. */
function replayOf(steps: ReplayStep[] | undefined, images: Map<string, string>, failure?: string): ReplayFrame[] | undefined {
  if (!steps || steps.length < 2) return undefined;
  const frames = steps.map((step) => ({ src: images.get(step.file) ?? "", cap: stepCaption(step, failure), ok: step.status !== "failed" }));
  return frames.every((f) => f.src !== "") ? frames : undefined;
}

/** One screenshot, or the same test's screen before and after a fix. Each is a step-by-step replay when Kane's frames are there. */
function shotsBlock(claim: VerdictClaim, flow: FlowResult | undefined, input: ScorecardInput): string {
  const images = input.images;
  const latest = flow?.screenshot ? images.get(flow.screenshot) : undefined;
  const proof = flow && input.results && claim.fix && claim.status === "proven" ? fixProof(input.results, flow) : undefined;
  const before = proof?.failedShot ? images.get(proof.failedShot) : undefined;
  const after = replayOf(flow?.frames, images, flow?.failure?.error ?? flow?.failure?.kaneSays);
  if (proof && before && latest) {
    const failed = shotFigure(before, `Before the fix: ${claim.claim}`, `Before · Kane's run at ${clock(proof.failedAt)} UTC failed`, replayOf(proof.failedFrames, images));
    return `<div class="pair">${failed}${shotFigure(latest, `After the fix: ${claim.claim}`, `After · the same test at ${clock(proof.passedAt)} UTC passed`, after)}</div>`;
  }
  return latest ? shotFigure(latest, `Kane screenshot for: ${claim.claim}`, after ? "Kane's run, step by step: press play, or drag the slider" : undefined, after) : "";
}

/** The facts under a claim that come from Kane's results, not from the agent: which flow, how it went, where to replay it. */
function flowMeta(flow: FlowResult, share: { url: string; latest: boolean } | undefined, trail: string): string {
  const title = flow.title ? ` “${escapeHtml(flow.title)}”` : "";
  // On a failing flow the count would mislead: the checks before the failing step did pass.
  const checks = flow.asserts && flow.status === "passed" ? ` · ${flow.asserts.passed} of ${flow.asserts.total} assert step(s) passed` : "";
  const target = flow.startUrl ? ` · run against <code>${escapeHtml(flow.startUrl)}</code> instead of the flow's own URL` : "";
  const manager = share ? ` · ${link(share.url, share.latest ? "Kane Test Manager run" : "Kane Test Manager (earlier run)")}` : "";
  const record = trail ? `<br>Kane's record (UTC): ${escapeHtml(trail)}` : "";
  return `<div class="muted" style="font-size:13px;margin-top:8px">Flow <code>${escapeHtml(flow.name)}</code>${title} · ${escapeHtml(flow.status)} after ${escapeHtml(flow.attempts)} Kane run(s)${checks}${target}${manager}${record}</div>`;
}

function claimCard(claim: VerdictClaim, input: ScorecardInput): string {
  const flow = flowFor(claim, input.results);
  const steps = claim.investigation?.length
    ? `<ol class="timeline">${claim.investigation
        .map((s) => `<li><b>Round ${escapeHtml(s.round)}.</b> Kane: ${escapeHtml(s.kane)} → ${escapeHtml(s.action)}</li>`)
        .join("")}</ol>`
    : "";
  const share = flow ? shareLink(flow) : undefined;
  const trail = flow ? runTrail(flow, input.results) : "";
  const meta = flow ? flowMeta(flow, share, trail) : "";
  return `<section class="card" id="claim-${escapeHtml(claim.id)}">${badge(claimLabel(claim))}<span class="claim${claim.status === "withdrawn" ? " struck" : ""}">${escapeHtml(claim.claim)}</span>
<div class="source">${escapeHtml(claim.source)}</div><div>${escapeHtml(claim.evidence)}</div>${bugLine(flow)}${fixBlock(claim, flow, input.results)}${meta}${steps}${shotsBlock(claim, flow, input)}</section>`;
}

function signOffLine(input: ScorecardInput): string {
  const signed = kaneSignOff(input.verdict, input.results);
  if (!signed) return "";
  const pack = signed.kane.packSha256 ? ` · pack <code>${escapeHtml(signed.kane.packSha256.slice(0, 12))}</code>` : "";
  return `<p class="stamp ${signed.kane.result === "pass" ? "ok" : "bad"}">Kane's verdict on the sealed evidence pack: <b>${escapeHtml(verdictWord(signed.kane))}</b> · policy <code>${escapeHtml(signed.kane.policy)}</code>${pack}</p>`;
}

/** The denominator, in the header: how many promises Kane found in the README and how many were tested. */
function coverageNote(input: ScorecardInput): string {
  const line = coverageLine(input.verdict, input.scan);
  const warning = coverageWarning(input.scan);
  return `<p class="muted" style="margin:4px 0 0;font-size:14px">${escapeHtml(line ? `${line}.` : warning ?? "")}</p>`;
}

export function coverageWarning(scan?: ScanResult): string | undefined {
  if (!scan || scan.useCases?.length) return undefined;
  return `README coverage was not established. Counts cover only the listed claims.${scan.useCasesNote ? ` ${scan.useCasesNote}` : ""}`;
}

function header(input: ScorecardInput): string {
  const verdict = input.verdict;
  const p = verdict.project;
  const local = p.live !== undefined && safeHref(p.live) !== undefined && isPrivateHost(p.live);
  const links = [
    local ? `<span class="muted">Tested on the builder's local build, ${escapeHtml(p.live)}</span>` : safeHref(p.live) && link(p.live, "Live demo"),
    safeHref(p.repo) && link(p.repo, "Repository"),
    safeHref(p.submission) && link(p.submission, "Submission"),
    safeHref(p.video) && link(p.video, "Video"),
  ].filter(Boolean);
  const o = overall(verdict);
  const c = claimCounts(verdict);
  const mode = verdict.mode === "preflight" ? '<div class="mode">Pre-flight · checked and fixed by the builder before submitting</div>' : "";
  // The biggest number is the one Kane backs. The rubric score is the agent's judgement and says so.
  return `<header class="hero"><div>${mode}<h1>${escapeHtml(p.name)}</h1><div class="links">${links.join("")}</div>
<p class="headline">${escapeHtml(headline(verdict))}</p>${coverageNote(input)}${signOffLine(input)}</div>
<div class="total"><b>${c.proven}<span class="of">/${verdict.claims.length}</span></b><span class="muted">claims proven by Kane</span>
<span class="rubric">Rubric ${o.pct}% <span class="muted">(${escapeHtml(`${o.score}/${o.max}`)}, the agent's judgement)</span></span></div></header>`;
}

function flagsSection(input: ScorecardInput): string {
  const flags = allFlags(input);
  if (flags.length === 0) return "";
  return `<h2>Red flags</h2>${flags.map((f) => `<div class="flag">${escapeHtml(f)}</div>`).join("")}`;
}

function fact(label: string, value: string | number | undefined): string {
  return value === undefined || value === "" ? "" : `<div><b>${escapeHtml(label)}</b>${escapeHtml(value)}</div>`;
}

function factsSection(scan?: ScanResult): string {
  const repo = scan?.repos[0];
  if (!scan || !repo) return "";
  const c = repo.commits;
  const window = c.inWindow !== undefined ? `${c.beforeWindow ?? 0} before · ${c.inWindow} during · ${c.afterWindow ?? 0} after` : undefined;
  const langs = Object.entries(repo.languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l).join(", ");
  return `<h2>Repository facts</h2><div class="facts">${[
    fact("Repository", repo.fullName),
    fact("Created", repo.createdAt?.slice(0, 10)),
    fact("Commits read", `${c.sampled}${c.complete ? "" : "+"}`),
    fact("First / last commit", c.first ? `${c.first.slice(0, 10)} → ${c.last?.slice(0, 10) ?? "?"}` : undefined),
    fact("Event window", window),
    fact("Authors", c.authors.length || undefined),
    fact("Languages", langs || undefined),
    fact("Live demo", scan.live ? `HTTP ${scan.liveStatus ?? "?"}` : "none found"),
  ].join("")}</div>`;
}

/** Says whether this report was checked against Kane's sealed packs themselves, or only against the recorded results. */
function packNote(packs?: PackCheck): string {
  if (!packs || packs.verified + packs.missing === 0) return "";
  const shared = packs.shared ? ` ${packs.shared === packs.verified ? "They are" : `${packs.shared} of them are`} share copies: the Kane account and local paths were removed, and everything else is as Kane sealed it.` : "";
  if (packs.missing === 0) return ` When this report was built, all ${packs.verified} pack(s) were re-read: each still had the hash recorded for it, and each flow's status in the pack matched the results.${shared}`;
  const some = packs.verified ? `${packs.verified} pack(s) were re-read and matched; ` : "";
  return ` When this report was built, ${some}${packs.missing} pack(s) were not on this machine, so those runs were checked against the recorded results only.${shared} The Test Manager links are Kane's own copy.`;
}

/** One line per use-case Kane found in the README, with the claim that accounts for it. */
export function coverageRows(verdict: Verdict, scan?: ScanResult): Array<{ id: string; title: string; anchor?: string; risk?: string; claims: VerdictClaim[] }> {
  return (scan?.useCases ?? []).map((u) => ({ id: u.id, title: u.title, anchor: u.anchor, risk: u.risk, claims: verdict.claims.filter((c) => c.covers?.includes(u.id)) }));
}

/** "Kane found 5 use-cases in the README: 4 tested, 1 not tested" */
export function coverageLine(verdict: Verdict, scan?: ScanResult): string | undefined {
  const rows = coverageRows(verdict, scan);
  if (rows.length === 0) return undefined;
  const tested = rows.filter((row) => row.claims.some((c) => c.status === "proven" || c.status === "broken")).length;
  return `Kane found ${rows.length} use-case(s) in the README: ${tested} tested by a Kane flow, ${rows.length - tested} not`;
}

/** The denominator: what the README promises (as Kane itself read it), and what became of each promise. */
function coverageSection(input: ScorecardInput): string {
  const rows = coverageRows(input.verdict, input.scan);
  const line = coverageLine(input.verdict, input.scan);
  if (!line) return "";
  const body = rows
    .map((row) => {
      const claims = row.claims.map((c) => `${badge(claimLabel(c))} <span class="muted">${escapeHtml(c.id)}</span>`).join(" ") || '<span class="muted">not covered</span>';
      return `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.risk ?? "")}</td><td>${escapeHtml(row.anchor ?? "")}</td><td>${claims}</td></tr>`;
    })
    .join("");
  return `<h2>Coverage: everything the README promises</h2><p class="muted">${escapeHtml(line)}. The list is Kane's own reading of the README (<code>kane-cli context ingest</code>), so the agent can't pick only the promises that hold: a verdict that leaves one out is refused.</p>
<div class="table-scroll"><table><thead><tr><th>#</th><th>Use-case Kane found</th><th>Risk</th><th>README</th><th>Claim</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function runsSection(results?: KaneResults, packs?: PackCheck): string {
  if (!results || results.runs.length === 0) return "";
  const rows = results.runs
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.at.slice(0, 16).replace("T", " "))}</td><td>${escapeHtml(r.flows.join(", "))}</td>
<td>${escapeHtml(r.outcome)}${r.heal === false ? " · healing off" : ""}</td><td>${escapeHtml(r.durationS)}s</td><td>${escapeHtml(r.kaneVerdict ? verdictWord(r.kaneVerdict) : "—")}</td>
<td>${escapeHtml(r.evidencePath?.split("/").pop()?.slice(0, 13) ?? r.reason ?? "")}</td></tr>`,
    )
    .join("");
  const flows = Object.values(results.flows);
  const sealed = results.runs.filter((r) => r.evidencePath).length;
  const judged = results.runs.filter((r) => r.kaneVerdict).length;
  const verdicts = judged ? ` Kane's own verdict engine (<code>kane-cli evidence verdict</code>) judged ${judged} of them against the <code>kane-judge-claims</code> policy.` : "";
  return `<h2>Kane runs</h2><p class="muted">${results.runs.length} run(s) of ${flows.length} flow(s) in real Chrome via <code>kane-cli testrun</code>. ${sealed} sealed an evidence pack.${verdicts}${packNote(packs)}</p>
<div class="table-scroll"><table><thead><tr><th>#</th><th>When (UTC)</th><th>Flows</th><th>Outcome</th><th>Time</th><th>Kane's verdict</th><th>Evidence pack</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function footer(verdict: Verdict): string {
  const when = verdict.judgedAt ? ` on ${escapeHtml(verdict.judgedAt.slice(0, 10))}` : "";
  const what =
    verdict.mode === "preflight"
      ? `Pre-flight by Kane Judge${when} · evidence from Kane CLI (TestMu AI) · the builder's own check before submitting, not a judge's score.`
      : `Judged by Kane Judge${when} · evidence from Kane CLI (TestMu AI) · first-round triage for human judges, not a final decision.`;
  return `<footer>${what}</footer>`;
}

/** The scorecard: one self-contained HTML page per project. */
export function renderScorecard(input: ScorecardInput): string {
  const v = input.verdict;
  const scores = v.scores.map((s) => scoreRow(s.criterion, s.score, s.max, s.why, s.unverified)).join("");
  const questions = v.questions.length ? `<h2>Questions to ask the team</h2><ol>${v.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>` : "";
  const body = [
    header(input),
    `<h2>Summary</h2><p>${escapeHtml(v.summary)}</p>`,
    `<h2>Claims, tested in a real browser</h2>${claimsInReadingOrder(v).map((c) => claimCard(c, input)).join("")}`,
    coverageSection(input),
    scores &&
      `<h2>Suggested scores${v.rubric ? ` · ${escapeHtml(v.rubric)}` : ""}</h2><p class="muted">The agent's judgement, for a human judge to adjust. Each score has to cite the claims it rests on, or say what couldn't be verified.</p><div class="card">${scores}</div>`,
    flagsSection(input),
    questions,
    runsSection(input.results, input.packs),
    factsSection(input.scan),
    footer(v),
  ];
  const meta: Record<string, string> = input.results ? { [RESULTS_META]: resultsStamp(input.results) } : {};
  return page(`${v.project.name} · Kane Judge scorecard`, body.filter(Boolean).join("\n"), meta);
}
