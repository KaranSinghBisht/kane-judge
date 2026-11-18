import type { KanePolicyVerdict } from "../kane/policy.js";
import type { ScanResult } from "../scan/types.js";
import { demoInjectionHints } from "./demo-hints.js";
import { badge, escapeHtml, link, page, safeHref, scoreRow } from "./html.js";
import { fixProof, resultsStamp, type FlowResult, type KaneResults, type RunRecord } from "./results.js";
import { CLAIM_STATUSES, type ClaimStatus, type Verdict, type VerdictClaim } from "./verdict.js";

/** The <meta> tag in which a scorecard records the Kane runs it was built from (see `resultsStamp`). */
export const RESULTS_META = "kane-judge-results";

export interface ScorecardInput {
  verdict: Verdict;
  results?: KaneResults;
  scan?: ScanResult;
  /** Project-relative screenshot path -> data URI. */
  images: Map<string, string>;
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

const stemOf = (flowPath: string) => flowPath.split("/").pop()?.replace(/_test\.md$/, "") ?? "";

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

/**
 * Kane's own record of a flow's runs: "✗ 20:25 → ✗ 20:32 (flow rewritten) → ✓ 20:35".
 * Built from run results and flow hashes, never from the judge's notes.
 */
export function runTrail(flow: FlowResult): string {
  const history = flow.history ?? [];
  return history
    .map((run, i) => {
      const before = history[i - 1];
      const rewritten = before?.flowSha && run.flowSha && before.flowSha !== run.flowSha ? " (flow rewritten)" : "";
      return `${run.status === "passed" ? "✓" : "✗"} ${clock(run.at)}${rewritten}`;
    })
    .join(" → ");
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

function fixBlock(claim: VerdictClaim, flow?: FlowResult): string {
  if (!claim.fix) return "";
  const lead = claim.status === "withdrawn" ? "Claim withdrawn." : claim.status === "proven" ? "Fixed in pre-flight." : "Fix attempted; Kane still fails it.";
  const files = claim.fix.files.length ? ` <span class="muted">Changed: ${claim.fix.files.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}</span>` : "";
  const proof = flow && claim.status === "proven" ? fixProof(flow) : undefined;
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
  const proof = claim.fix && claim.status === "proven" ? fixProof(flow) : undefined;
  return [proof?.failedShot, flow.screenshot].filter((s): s is string => !!s);
}

function shot(src: string, alt: string, caption?: string): string {
  const img = `<img class="shot" alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`;
  return caption ? `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>` : img;
}

/** One screenshot, or the same test's screen before and after a fix. */
function shotsBlock(claim: VerdictClaim, flow: FlowResult | undefined, images: Map<string, string>): string {
  const latest = flow?.screenshot ? images.get(flow.screenshot) : undefined;
  const proof = flow && claim.fix && claim.status === "proven" ? fixProof(flow) : undefined;
  const before = proof?.failedShot ? images.get(proof.failedShot) : undefined;
  if (proof && before && latest) {
    return `<div class="pair">${shot(before, `Before the fix: ${claim.claim}`, `Before · Kane's run at ${clock(proof.failedAt)} UTC failed`)}${shot(
      latest,
      `After the fix: ${claim.claim}`,
      `After · the same test at ${clock(proof.passedAt)} UTC passed`,
    )}</div>`;
  }
  return latest ? shot(latest, `Kane screenshot for: ${claim.claim}`) : "";
}

function claimCard(claim: VerdictClaim, input: ScorecardInput): string {
  const flow = flowFor(claim, input.results);
  const steps = claim.investigation?.length
    ? `<ol class="timeline">${claim.investigation
        .map((s) => `<li><b>Round ${escapeHtml(s.round)}.</b> Kane: ${escapeHtml(s.kane)} → ${escapeHtml(s.action)}</li>`)
        .join("")}</ol>`
    : "";
  const share = flow ? shareLink(flow) : undefined;
  const trail = flow ? runTrail(flow) : "";
  const meta = flow
    ? `<div class="muted" style="font-size:13px;margin-top:8px">Flow <code>${escapeHtml(flow.name)}</code> · ${escapeHtml(flow.status)} after ${escapeHtml(flow.attempts)} Kane run(s)${
        share ? ` · ${link(share.url, share.latest ? "Kane Test Manager run" : "Kane Test Manager (earlier run)")}` : ""
      }${trail ? `<br>Kane's record (UTC): ${escapeHtml(trail)}` : ""}</div>`
    : "";
  return `<section class="card">${badge(claimLabel(claim))}<span class="claim${claim.status === "withdrawn" ? " struck" : ""}">${escapeHtml(claim.claim)}</span>
<div class="source">${escapeHtml(claim.source)}</div><div>${escapeHtml(claim.evidence)}</div>${bugLine(flow)}${fixBlock(claim, flow)}${meta}${steps}${shotsBlock(claim, flow, input.images)}</section>`;
}

function signOffLine(input: ScorecardInput): string {
  const signed = kaneSignOff(input.verdict, input.results);
  if (!signed) return "";
  const pack = signed.kane.packSha256 ? ` · pack <code>${escapeHtml(signed.kane.packSha256.slice(0, 12))}</code>` : "";
  return `<p class="stamp ${signed.kane.result === "pass" ? "ok" : "bad"}">Kane's verdict on the sealed evidence pack: <b>${escapeHtml(verdictWord(signed.kane))}</b> · policy <code>${escapeHtml(signed.kane.policy)}</code>${pack}</p>`;
}

function header(input: ScorecardInput): string {
  const verdict = input.verdict;
  const p = verdict.project;
  const links = [
    safeHref(p.live) && link(p.live, "Live demo"),
    safeHref(p.repo) && link(p.repo, "Repository"),
    safeHref(p.submission) && link(p.submission, "Submission"),
    safeHref(p.video) && link(p.video, "Video"),
  ].filter(Boolean);
  const o = overall(verdict);
  const mode = verdict.mode === "preflight" ? '<div class="mode">Pre-flight · checked and fixed by the builder before submitting</div>' : "";
  return `<header class="hero"><div>${mode}<h1>${escapeHtml(p.name)}</h1><div class="links">${links.join("")}</div>
<p class="headline">${escapeHtml(headline(verdict))}</p>${signOffLine(input)}</div>
<div class="total"><b>${o.pct}%</b><span class="muted">${escapeHtml(`${o.score} / ${o.max}`)}</span></div></header>`;
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

function runsSection(results?: KaneResults): string {
  if (!results || results.runs.length === 0) return "";
  const rows = results.runs
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.at.slice(0, 16).replace("T", " "))}</td><td>${escapeHtml(r.flows.join(", "))}</td>
<td>${escapeHtml(r.outcome)}</td><td>${escapeHtml(r.durationS)}s</td><td>${escapeHtml(r.kaneVerdict ? verdictWord(r.kaneVerdict) : "—")}</td>
<td>${escapeHtml(r.evidencePath?.split("/").pop()?.slice(0, 13) ?? r.reason ?? "")}</td></tr>`,
    )
    .join("");
  const flows = Object.values(results.flows);
  const sealed = results.runs.filter((r) => r.evidencePath).length;
  const judged = results.runs.filter((r) => r.kaneVerdict).length;
  const verdicts = judged ? ` Kane's own verdict engine (<code>kane-cli evidence verdict</code>) judged ${judged} of them against the <code>kane-judge-claims</code> policy.` : "";
  return `<h2>Kane runs</h2><p class="muted">${results.runs.length} run(s) of ${flows.length} flow(s) in real Chrome via <code>kane-cli testrun</code>. ${sealed} sealed an evidence pack.${verdicts}</p>
<table><thead><tr><th>#</th><th>When (UTC)</th><th>Flows</th><th>Outcome</th><th>Time</th><th>Kane's verdict</th><th>Evidence pack</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  const scores = v.scores.map((s) => scoreRow(s.criterion, s.score, s.max, s.why)).join("");
  const questions = v.questions.length ? `<h2>Questions to ask the team</h2><ol>${v.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>` : "";
  const body = [
    header(input),
    `<h2>Summary</h2><p>${escapeHtml(v.summary)}</p>`,
    `<h2>Claims, tested in a real browser</h2>${claimsInReadingOrder(v).map((c) => claimCard(c, input)).join("")}`,
    scores && `<h2>Scores${v.rubric ? ` · ${escapeHtml(v.rubric)}` : ""}</h2><div class="card">${scores}</div>`,
    flagsSection(input),
    questions,
    runsSection(input.results),
    factsSection(input.scan),
    footer(v),
  ];
  const meta: Record<string, string> = input.results ? { [RESULTS_META]: resultsStamp(input.results) } : {};
  return page(`${v.project.name} · Kane Judge scorecard`, body.filter(Boolean).join("\n"), meta);
}
