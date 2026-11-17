import { safeHref } from "./html.js";
import { claimCounts, flowFor, headline, overall, type ScorecardInput } from "./scorecard.js";

/** A Markdown link only for http(s) URLs; local paths and other schemes never leave the machine in a report. */
function mdLink(url: string | undefined, label: string): string | undefined {
  const href = safeHref(url);
  return href ? `[${label}](${href})` : undefined;
}

/** Markdown has no escaping story for raw HTML in many renderers; neutralise angle brackets in untrusted text. */
function md(text: string | number | undefined): string {
  return String(text ?? "").replace(/</g, "‹").replace(/>/g, "›").replace(/\r?\n/g, " ");
}

const ICON: Record<string, string> = { proven: "✅", broken: "❌", unverifiable: "⚠️", untested: "▫️" };

/** report.md: the scorecard as plain Markdown, for terminals, PR comments and GitHub. */
export function renderReportMarkdown(input: ScorecardInput): string {
  const v = input.verdict;
  const o = overall(v);
  const c = claimCounts(v);
  const lines = [
    `# ${md(v.project.name)} · ${o.pct}% (${o.score}/${o.max})`,
    "",
    `**${md(headline(v))}**`,
    "",
    [mdLink(v.project.live, "Live demo"), mdLink(v.project.repo, "Repo"), mdLink(v.project.submission, "Submission"), mdLink(v.project.video, "Video")]
      .filter(Boolean)
      .join(" · "),
    "",
    md(v.summary),
    "",
    "## Claims",
  ];
  for (const claim of v.claims) {
    const flow = flowFor(claim, input.results);
    lines.push(`- ${ICON[claim.status] ?? ""} **${md(claim.claim)}** (${claim.status}). ${md(claim.evidence)}`);
    lines.push(`  - Source: “${md(claim.source)}”`);
    if (flow) lines.push(`  - Kane flow \`${md(flow.name)}\`: ${md(flow.status)} after ${flow.attempts} run(s)${flow.screenshot ? ` · screenshot \`${md(flow.screenshot)}\`` : ""}${flow.shareUrl ? ` · ${flow.shareUrl}` : ""}`);
    for (const step of claim.investigation ?? []) lines.push(`  - Round ${step.round}: Kane: ${md(step.kane)} → ${md(step.action)}`);
  }
  lines.push("", "## Scores", ...v.scores.map((s) => `- **${md(s.criterion)}** ${s.score}/${s.max}: ${md(s.why)}`));
  const flags = [...v.flags, ...(input.scan?.injectionHints ?? []).map((h) => `Prompt injection aimed at AI judges: ${h}`)];
  if (flags.length) lines.push("", "## Red flags", ...flags.map((f) => `- ${md(f)}`));
  if (v.questions.length) lines.push("", "## Questions to ask the team", ...v.questions.map((q, i) => `${i + 1}. ${md(q)}`));
  lines.push("", `_${c.proven} proven · ${c.broken} broken · ${c.unverifiable} unverifiable · ${c.untested} untested. Judged by Kane Judge with evidence from Kane CLI; first-round triage for human judges._`, "");
  return lines.join("\n");
}
