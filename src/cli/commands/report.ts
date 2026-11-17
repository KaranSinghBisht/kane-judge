import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScanResult } from "../../scan/types.js";
import { readJsonFile, writeTextAtomic } from "../../shared/fs.js";
import { out } from "../../shared/logger.js";
import { boardRows, renderBoardHtml, renderBoardMarkdown } from "../../judge/board.js";
import { imageDataUri } from "../../judge/html.js";
import { renderReportMarkdown } from "../../judge/report-md.js";
import { isKaneResults, type KaneResults } from "../../judge/results.js";
import { flowFor, headline, overall, renderScorecard } from "../../judge/scorecard.js";
import type { Verdict } from "../../judge/verdict.js";
import { checkVerdict } from "../../judge/verdict-check.js";
import { PROJECTS_DIR, projectPaths, type ProjectPaths } from "../../judge/workspace.js";

type Loaded = { ok: true; verdict: Verdict; results?: KaneResults; scan?: ScanResult } | { ok: false; errors: string[] };

async function load(paths: ProjectPaths): Promise<Loaded> {
  let raw: unknown;
  try {
    raw = await readJsonFile(paths.verdict);
  } catch (err) {
    return { ok: false, errors: [`verdict.json is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`] };
  }
  if (raw === undefined) return { ok: false, errors: [`no verdict.json in ${paths.dir} yet`] };
  const checked = checkVerdict(raw);
  if (!checked.ok) return checked;
  const results = await readJsonFile(paths.results).catch(() => undefined);
  const scan = (await readJsonFile(paths.scan).catch(() => undefined)) as ScanResult | undefined;
  return { ok: true, verdict: checked.verdict, results: isKaneResults(results) ? results : undefined, scan: scan?.version === 1 ? scan : undefined };
}

async function images(paths: ProjectPaths, verdict: Verdict, results?: KaneResults): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const claim of verdict.claims) {
    const shot = flowFor(claim, results)?.screenshot;
    if (!shot || map.has(shot)) continue;
    const uri = await imageDataUri(join(paths.dir, shot));
    if (uri) map.set(shot, uri);
  }
  return map;
}

/** `kane-judge report <project>`: validate verdict.json and write scorecard.html + report.md. */
export async function reportCommand(dir: string): Promise<number> {
  const paths = projectPaths(dir);
  const loaded = await load(paths);
  if (!loaded.ok) {
    out(`Can't build the scorecard yet:\n${loaded.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 2;
  }
  const input = { verdict: loaded.verdict, results: loaded.results, scan: loaded.scan, images: await images(paths, loaded.verdict, loaded.results) };
  await writeTextAtomic(paths.scorecardHtml, renderScorecard(input));
  await writeTextAtomic(paths.reportMd, renderReportMarkdown(input));
  const o = overall(loaded.verdict);
  out(`${loaded.verdict.project.name}: ${o.pct}% · ${headline(loaded.verdict)}\nScorecard: ${paths.scorecardHtml}\nReport:    ${paths.reportMd}`);
  return 0;
}

/** `kane-judge board [workspace]`: rank every judged project. */
export async function boardCommand(workspace: string): Promise<number> {
  const root = join(workspace, PROJECTS_DIR);
  const slugs = await readdir(root).catch(() => [] as string[]);
  const entries: Array<{ verdict: Verdict; results?: KaneResults }> = [];
  for (const slug of slugs.sort()) {
    const loaded = await load(projectPaths(join(root, slug)));
    if (loaded.ok) entries.push({ verdict: loaded.verdict, results: loaded.results });
    else out(`skipped ${slug}: ${loaded.errors[0] ?? "no verdict"}`);
  }
  if (entries.length === 0) {
    out(`No judged projects under ${root} yet.`);
    return 2;
  }
  const rows = boardRows(entries);
  await writeTextAtomic(join(workspace, "SCOREBOARD.md"), renderBoardMarkdown(rows));
  await writeTextAtomic(join(workspace, "scoreboard.html"), renderBoardHtml(rows));
  out([...rows.map((r) => `${r.rank}. ${r.name}: ${r.pct}% (${r.proven}/${r.claims} proven, ${r.broken} broken)`), "", `Wrote ${join(workspace, "SCOREBOARD.md")} and scoreboard.html`].join("\n"));
  return 0;
}
