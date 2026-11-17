import type { ScanResult } from "../scan/types.js";
import { badge, escapeHtml, link, page, scoreRow } from "./html.js";
import type { FlowResult, KaneResults } from "./results.js";
import { CLAIM_STATUSES, type ClaimStatus, type Verdict, type VerdictClaim } from "./verdict.js";

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

/** "Kane proved 3 of 5 claims · 1 broken · 1 unverifiable" */
export function headline(verdict: Verdict): string {
  const c = claimCounts(verdict);
  const rest = [c.broken && `${c.broken} broken`, c.unverifiable && `${c.unverifiable} unverifiable`, c.untested && `${c.untested} untested`].filter(Boolean);
  return [`Kane proved ${c.proven} of ${verdict.claims.length} claims`, ...rest].join(" · ");
}

/** The Kane result behind a claim (flows/02-promo_test.md -> results.flows["02-promo"]). */
export function flowFor(claim: VerdictClaim, results?: KaneResults): FlowResult | undefined {
  if (!claim.flow || !results) return undefined;
  const stem = claim.flow.split("/").pop()?.replace(/_test\.md$/, "") ?? "";
  return results.flows[stem];
}

function claimCard(claim: VerdictClaim, input: ScorecardInput): string {
  const flow = flowFor(claim, input.results);
  const image = flow?.screenshot ? input.images.get(flow.screenshot) : undefined;
  const steps = claim.investigation?.length
    ? `<ol class="timeline">${claim.investigation
        .map((s) => `<li><b>Round ${escapeHtml(s.round)}.</b> Kane: ${escapeHtml(s.kane)} → ${escapeHtml(s.action)}</li>`)
        .join("")}</ol>`
    : "";
  const meta = flow
    ? `<div class="muted" style="font-size:13px;margin-top:8px">Flow <code>${escapeHtml(flow.name)}</code> · ${escapeHtml(flow.status)} after ${escapeHtml(flow.attempts)} Kane run(s)${
        flow.shareUrl ? ` · ${link(flow.shareUrl, "Kane Test Manager run")}` : ""
      }</div>`
    : "";
  return `<section class="card">${badge(claim.status)}<span class="claim">${escapeHtml(claim.claim)}</span>
<div class="source">“${escapeHtml(claim.source)}”</div><div>${escapeHtml(claim.evidence)}</div>${meta}${steps}${
    image ? `<img class="shot" alt="${escapeHtml(`Kane screenshot for: ${claim.claim}`)}" src="${escapeHtml(image)}">` : ""
  }</section>`;
}

function header(verdict: Verdict): string {
  const p = verdict.project;
  const links = [
    p.live && link(p.live, "Live demo"),
    p.repo && link(p.repo, "Repository"),
    p.submission && link(p.submission, "Submission"),
    p.video && link(p.video, "Video"),
  ].filter(Boolean);
  const o = overall(verdict);
  return `<header class="hero"><div><h1>${escapeHtml(p.name)}</h1><div class="links">${links.join("")}</div>
<p class="headline">${escapeHtml(headline(verdict))}</p></div>
<div class="total"><b>${o.pct}%</b><span class="muted">${escapeHtml(`${o.score} / ${o.max}`)}</span></div></header>`;
}

function flagsSection(verdict: Verdict, scan?: ScanResult): string {
  const flags = [...verdict.flags, ...(scan?.injectionHints ?? []).map((h) => `Prompt injection aimed at AI judges: ${h}`)];
  if (flags.length === 0) return "";
  return `<h2>Red flags</h2>${[...new Set(flags)].map((f) => `<div class="flag">${escapeHtml(f)}</div>`).join("")}`;
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
<td>${escapeHtml(r.outcome)}</td><td>${escapeHtml(r.durationS)}s</td><td>${escapeHtml(r.evidencePath?.split("/").pop()?.slice(0, 13) ?? r.reason ?? "")}</td></tr>`,
    )
    .join("");
  const flows = Object.values(results.flows);
  const authored = flows.filter((f) => f.authored).length;
  return `<h2>Kane runs</h2><p class="muted">${results.runs.length} run(s) of ${flows.length} flow(s) in real Chrome via <code>kane-cli testrun</code>; ${authored} flow(s) authored by Kane's AI, the rest replayed from cache. Every run sealed an evidence pack.</p>
<table><thead><tr><th>#</th><th>When (UTC)</th><th>Flows</th><th>Outcome</th><th>Time</th><th>Evidence pack</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The scorecard: one self-contained HTML page per project. */
export function renderScorecard(input: ScorecardInput): string {
  const v = input.verdict;
  const scores = v.scores.map((s) => scoreRow(s.criterion, s.score, s.max, s.why)).join("");
  const questions = v.questions.length ? `<h2>Questions to ask the team</h2><ol>${v.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>` : "";
  const body = [
    header(v),
    `<h2>Summary</h2><p>${escapeHtml(v.summary)}</p>`,
    scores && `<h2>Scores${v.rubric ? ` · ${escapeHtml(v.rubric)}` : ""}</h2><div class="card">${scores}</div>`,
    `<h2>Claims, tested in a real browser</h2>${v.claims.map((c) => claimCard(c, input)).join("")}`,
    flagsSection(v, input.scan),
    questions,
    runsSection(input.results),
    factsSection(input.scan),
    `<footer>Judged by Kane Judge${v.judgedAt ? ` on ${escapeHtml(v.judgedAt.slice(0, 10))}` : ""} · evidence from Kane CLI (TestMu AI) · first-round triage for human judges, not a final decision.</footer>`,
  ];
  return page(`${v.project.name} · Kane Judge scorecard`, body.filter(Boolean).join("\n"));
}
