import { escapeHtml, link, page } from "./html.js";
import type { KaneResults } from "./results.js";
import { claimCounts, overall } from "./scorecard.js";
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
  claims: number;
  flags: number;
  live?: string;
  kaneRuns: number;
}

/** Leaderboard rows, best first; ties go to the project with more proven claims. */
export function boardRows(entries: Array<{ verdict: Verdict; results?: KaneResults }>): BoardRow[] {
  const rows = entries.map(({ verdict, results }) => {
    const o = overall(verdict);
    const c = claimCounts(verdict);
    return {
      rank: 0,
      name: verdict.project.name,
      slug: verdict.project.slug,
      pct: o.pct,
      score: o.score,
      max: o.max,
      proven: c.proven,
      broken: c.broken,
      unverifiable: c.unverifiable,
      claims: verdict.claims.length,
      flags: verdict.flags.length,
      live: verdict.project.live,
      kaneRuns: results?.runs.length ?? 0,
    };
  });
  rows.sort((a, b) => b.pct - a.pct || b.proven - a.proven || a.name.localeCompare(b.name));
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

const card = (slug: string) => `${PROJECTS_DIR}/${slug}/scorecard.html`;

export function renderBoardMarkdown(rows: BoardRow[]): string {
  const head = ["| # | Project | Score | Proven | Broken | Unverifiable | Flags |", "|---|---|---|---|---|---|---|"];
  const body = rows.map(
    (r) => `| ${r.rank} | [${r.name.replace(/[|<>]/g, " ")}](${card(r.slug)}) | ${r.pct}% | ${r.proven}/${r.claims} | ${r.broken} | ${r.unverifiable} | ${r.flags} |`,
  );
  return ["# Scoreboard", "", ...head, ...body, "", "_Judged by Kane Judge with evidence from Kane CLI. First-round triage for human judges._", ""].join("\n");
}

export function renderBoardHtml(rows: BoardRow[]): string {
  const body = rows
    .map(
      (r) => `<tr><td>${r.rank}</td><td><a href="${escapeHtml(card(r.slug))}">${escapeHtml(r.name)}</a></td><td><b>${r.pct}%</b></td>
<td>${r.proven}/${r.claims}</td><td>${r.broken}</td><td>${r.unverifiable}</td><td>${r.flags}</td><td>${r.live ? link(r.live, "demo") : "—"}</td></tr>`,
    )
    .join("");
  const table = `<table><thead><tr><th>#</th><th>Project</th><th>Score</th><th>Proven</th><th>Broken</th><th>Unverifiable</th><th>Flags</th><th>Live</th></tr></thead><tbody>${body}</tbody></table>`;
  return page("Scoreboard · Kane Judge", `<h1>Scoreboard</h1><p class="muted">${rows.length} project(s), each judged by using its live demo through Kane CLI.</p>${table}
<footer>Judged by Kane Judge · evidence from Kane CLI (TestMu AI) · first-round triage for human judges.</footer>`);
}
