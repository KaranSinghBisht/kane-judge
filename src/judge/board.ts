import { escapeHtml, link, page } from "./html.js";
import type { ScanResult } from "../scan/types.js";
import { mdText } from "./markdown.js";
import type { KaneResults } from "./results.js";
import { allFlags, claimCounts, overall } from "./scorecard.js";
import type { Verdict } from "./verdict.js";
import { PROJECTS_DIR } from "./workspace.js";

export interface BoardRow {
  rank: number;
  name: string;
  slug: string;
  pct: number;
  score: number;
  max: number;
  proven: number;
  broken: number;
  unverifiable: number;
  /** Claims listed but never put to a test. They are shown, and they don't count against the project. */
  untested: number;
  /** Claims that got a verdict from testing: proven, broken or unverifiable. The ranking's denominator. */
  judged: number;
  claims: number;
  flags: number;
  live?: string;
  kaneRuns: number;
  /** True for a builder's own pre-flight (a self-check, not a judge's score). */
  preflight: boolean;
}

export interface BoardEntry {
  verdict: Verdict;
  results?: KaneResults;
  scan?: ScanResult;
  /** The project's folder name under projects/ (links point here, whatever the verdict says). */
  dir?: string;
}

/**
 * Leaderboard rows, best first. The rank follows what Kane proved: proven claims
 * as a share of the claims that were judged (proven, broken or unverifiable).
 * Untested claims stay out of that share, so a judge that lists more of a
 * README's promises doesn't push a project down. The rubric score, which is
 * the agent's judgement, only breaks ties.
 */
export function boardRows(entries: BoardEntry[]): BoardRow[] {
  const rows = entries.map(({ verdict, results, scan, dir }) => {
    const o = overall(verdict);
    const c = claimCounts(verdict);
    return {
      rank: 0,
      name: verdict.project.name,
      slug: dir ?? verdict.project.slug,
      pct: o.pct,
      score: o.score,
      max: o.max,
      proven: c.proven,
      broken: c.broken,
      unverifiable: c.unverifiable,
      untested: c.untested,
      judged: c.proven + c.broken + c.unverifiable,
      claims: verdict.claims.length,
      flags: allFlags({ verdict, scan, results }).length,
      live: verdict.project.live,
      kaneRuns: results?.runs.length ?? 0,
      preflight: verdict.mode === "preflight",
    };
  });
  const share = (row: { proven: number; judged: number }) => (row.judged > 0 ? row.proven / row.judged : 0);
  rows.sort((a, b) => share(b) - share(a) || b.pct - a.pct || b.proven - a.proven || a.name.localeCompare(b.name));
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

const RANKING_NOTE = "Ranked by the share of judged claims (proven, broken or unverifiable) that Kane proved. Untested claims are listed but don't count against a project. The rubric score is the agent's judgement and only breaks ties.";

const card = (slug: string) => `${PROJECTS_DIR}/${encodeURIComponent(slug)}/scorecard.html`;

export function renderBoardMarkdown(rows: BoardRow[]): string {
  const head = ["| # | Project | Proven by Kane | Broken | Unverifiable | Untested | Rubric | Flags |", "|---|---|---|---|---|---|---|---|"];
  const body = rows.map(
    (r) => `| ${r.rank} | [${mdText(r.name)}](${card(r.slug)})${r.preflight ? " (pre-flight)" : ""} | ${r.proven}/${r.judged} | ${r.broken} | ${r.unverifiable} | ${r.untested} | ${r.pct}% | ${r.flags} |`,
  );
  return ["# Scoreboard", "", ...head, ...body, "", `_${RANKING_NOTE} Judged by Kane Judge with evidence from Kane CLI. First-round triage for human judges._`, ""].join("\n");
}

export function renderBoardHtml(rows: BoardRow[]): string {
  const body = rows
    .map(
      (r) => `<tr><td>${r.rank}</td><td><a href="${escapeHtml(card(r.slug))}">${escapeHtml(r.name)}</a>${r.preflight ? ' <span class="muted">(pre-flight)</span>' : ""}</td><td><b>${r.proven}/${r.judged}</b></td>
<td>${r.broken}</td><td>${r.unverifiable}</td><td>${r.untested}</td><td>${r.pct}%</td><td>${r.flags}</td><td>${r.live ? link(r.live, "demo") : "—"}</td></tr>`,
    )
    .join("");
  const table = `<div class="table-scroll"><table><thead><tr><th>#</th><th>Project</th><th>Proven by Kane</th><th>Broken</th><th>Unverifiable</th><th>Untested</th><th>Rubric</th><th>Flags</th><th>Live</th></tr></thead><tbody>${body}</tbody></table></div>`;
  return page("Scoreboard · Kane Judge", `<h1>Scoreboard</h1><p class="muted">${rows.length} project(s), each judged by using its live demo through Kane CLI. ${RANKING_NOTE}</p>${table}
<footer>Judged by Kane Judge · evidence from Kane CLI (TestMu AI) · first-round triage for human judges.</footer>`);
}
