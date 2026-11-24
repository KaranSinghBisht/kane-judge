import { describePolicyVerdict } from "../kane/policy.js";
import { safeHref } from "./html.js";
import { mdText as md } from "./markdown.js";
import { fixProof } from "./results.js";
import { describeBugVerdict } from "./summary.js";
import { allFlags, claimCounts, claimLabel, claimsInReadingOrder, coverageLine, coverageRows, coverageWarning, flowFor, headline, kaneSignOff, overall, runTrail, shareLink, type ScorecardInput } from "./scorecard.js";
import type { VerdictClaim } from "./verdict.js";

/** A Markdown link only for http(s) URLs; local paths and other schemes never leave the machine in a report. */
function mdLink(url: string | undefined, label: string): string | undefined {
  const href = safeHref(url);
  return href ? `[${label}](${href})` : undefined;
}

const ICON: Record<string, string> = { proven: "✅", fixed: "🔧", broken: "❌", unverifiable: "⚠️", untested: "▫️", withdrawn: "➖" };

function fixLine(claim: VerdictClaim, input: ScorecardInput): string | undefined {
  if (!claim.fix) return undefined;
  const lead = claim.status === "withdrawn" ? "Claim withdrawn" : claim.status === "proven" ? "Fixed in pre-flight" : "Fix attempted; Kane still fails it";
  const files = claim.fix.files.length ? ` Changed: ${claim.fix.files.map((f) => `\`${md(f)}\``).join(", ")}.` : "";
  const flow = flowFor(claim, input.results);
  const proof = flow && input.results && claim.status === "proven" ? fixProof(input.results, flow) : undefined;
  const proven = proof ? ` Kane ran the same test before and after: failed at ${proof.failedAt.slice(11, 16)}, passed at ${proof.passedAt.slice(11, 16)} UTC.` : "";
  return `  - ${lead}: ${md(claim.fix.summary)}${files}${proven}`;
}

function claimLines(claim: VerdictClaim, input: ScorecardInput): string[] {
  const flow = flowFor(claim, input.results);
  const label = claimLabel(claim);
  const lines = [`- ${ICON[label] ?? ""} **${md(claim.claim)}** (${label}). ${md(claim.evidence)}`, `  - Source: ${md(claim.source)}`];
  const bug = flow && flow.status !== "passed" ? flow.failure?.bugVerdict : undefined;
  if (bug) lines.push(`  - Kane's bug verdict: Kane ${md(describeBugVerdict(bug))}`);
  const fix = fixLine(claim, input);
  if (fix) lines.push(fix);
  const share = flow ? shareLink(flow) : undefined;
  const trail = flow ? runTrail(flow) : "";
  if (flow) lines.push(`  - Kane flow \`${md(flow.name)}\`: ${md(flow.status)} after ${flow.attempts} run(s)${flow.screenshot ? ` · screenshot \`${md(flow.screenshot)}\`` : ""}${share ? ` · ${share.url}${share.latest ? "" : " (earlier run)"}` : ""}`);
  if (trail) lines.push(`  - Kane's record (UTC): ${trail}`);
  for (const step of claim.investigation ?? []) lines.push(`  - Round ${step.round}: Kane: ${md(step.kane)} → ${md(step.action)}`);
  return lines;
}

function footerLine(input: ScorecardInput): string {
  const c = claimCounts(input.verdict);
  const counts = `${c.proven} proven · ${c.broken} broken · ${c.unverifiable} unverifiable · ${c.untested} untested${c.withdrawn ? ` · ${c.withdrawn} withdrawn` : ""}`;
  return input.verdict.mode === "preflight"
    ? `_${counts}. Pre-flight by Kane Judge with evidence from Kane CLI; the builder's own check before submitting, not a judge's score._`
    : `_${counts}. Judged by Kane Judge with evidence from Kane CLI; first-round triage for human judges._`;
}

/** report.md: the scorecard as plain Markdown, for terminals, PR comments and GitHub. */
export function renderReportMarkdown(input: ScorecardInput): string {
  const v = input.verdict;
  const o = overall(v);
  const signed = kaneSignOff(v, input.results);
  const lines = [
    `# ${md(v.project.name)} · Kane proved ${claimCounts(v).proven} of ${v.claims.length} claims`,
    "",
    `**${md(headline(v))}** · rubric ${o.pct}% (${o.score}/${o.max}, the agent's judgement)`,
    ...(coverageWarning(input.scan) ? ["", `_${md(coverageWarning(input.scan) ?? "")}_`] : []),
    ...(v.mode === "preflight" ? ["", "_Pre-flight: checked and fixed by the builder before submitting._"] : []),
    ...(signed ? ["", `Kane's verdict on the sealed evidence pack (policy \`${md(signed.kane.policy)}\`): **${md(describePolicyVerdict(signed.kane))}**`] : []),
    "",
    [mdLink(v.project.live, "Live demo"), mdLink(v.project.repo, "Repo"), mdLink(v.project.submission, "Submission"), mdLink(v.project.video, "Video")]
      .filter(Boolean)
      .join(" · "),
    "",
    md(v.summary),
    "",
    "## Claims",
    ...claimsInReadingOrder(v).flatMap((claim) => claimLines(claim, input)),
  ];
  const coverage = coverageRows(v, input.scan);
  if (coverage.length) {
    lines.push("", "## Coverage: everything the README promises", "", `${md(coverageLine(v, input.scan) ?? "")}. The list is Kane's own reading of the README (\`kane-cli context ingest\`).`, "");
    lines.push(...coverage.map((row) => `- ${row.id} ${md(row.title)}${row.anchor ? ` (README ${row.anchor})` : ""}: ${row.claims.map((c) => `${c.id} ${claimLabel(c)}`).join(", ") || "not covered"}`));
  }
  lines.push("", "## Suggested scores", "", "_The agent's judgement, for a human judge to adjust._", "");
  lines.push(...v.scores.map((s) => `- **${md(s.criterion)}** ${s.score}/${s.max}: ${md(s.why)}${s.unverified ? ` Couldn't verify: ${md(s.unverified)}` : ""}`));
  const flags = allFlags(input);
  if (flags.length) lines.push("", "## Red flags", ...flags.map((f) => `- ${md(f)}`));
  if (v.questions.length) lines.push("", "## Questions to ask the team", ...v.questions.map((q, i) => `${i + 1}. ${md(q)}`));
  lines.push("", footerLine(input), "");
  return lines.join("\n");
}
