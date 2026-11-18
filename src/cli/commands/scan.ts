import { isLocalDir } from "../../scan/local.js";
import { scanSubmission } from "../../scan/scan.js";
import type { ScanResult } from "../../scan/types.js";
import { extractUseCases } from "../../kane/usecases.js";
import { KaneJudgeError } from "../../shared/errors.js";
import { displayPath } from "../../shared/fs.js";
import { out } from "../../shared/logger.js";

export interface ScanArgs {
  inputs: string[];
  live?: string;
  name?: string;
  slug?: string;
  since?: string;
  until?: string;
  workspace: string;
  /** The builder's own folder, checked before submitting. */
  preflight?: boolean;
  /** Skip asking Kane for the README's use-cases (`--no-use-cases`). */
  noUseCases?: boolean;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Every input must be an http(s) URL and dates must parse; returns the problems found. */
export function scanArgProblems(args: ScanArgs): string[] {
  const problems: string[] = [];
  if (args.inputs.length === 0) problems.push("give at least one submission page or GitHub repo URL");
  for (const input of args.inputs) {
    if (!isHttpUrl(input) && !isLocalDir(input)) problems.push(`not an http(s) URL or a local folder: ${input}`);
  }
  if (args.live && !isHttpUrl(args.live)) problems.push(`--live must be an http(s) URL: ${args.live}`);
  for (const [flag, value] of [["--since", args.since], ["--until", args.until]] as const) {
    if (value && Number.isNaN(Date.parse(value))) problems.push(`${flag} must be a date like 2026-11-12 (got ${value})`);
  }
  if (args.slug && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(args.slug)) problems.push("--slug may only use a-z, 0-9 and dashes");
  if (args.preflight && !args.inputs.some(isLocalDir)) problems.push("--preflight is for your own project: give its folder (a judge never fixes someone else's submission)");
  if (args.preflight && !args.live) problems.push("--preflight needs the URL of your running app, so Kane sees your fixes: --live http://localhost:<port>");
  return problems;
}

/** What Kane's own reading of the README found: the list every verdict has to account for. */
function useCaseSummary(result: ScanResult): string[] {
  if (!result.useCases?.length) return result.useCasesNote ? [`  use-cases  ${result.useCasesNote}`] : [];
  return [
    `  use-cases  Kane found ${result.useCases.length} in the README (kane-cli context ingest). Each needs a claim in the verdict:`,
    ...result.useCases.map((u) => `             ${u.id} [${u.risk ?? "?"}] ${u.title}${u.anchor ? ` (README ${u.anchor})` : ""}`),
  ];
}

function describe(result: ScanResult, dir: string): string {
  const repoLines = result.repos.map((r) => {
    if (r.error) return `  repo     ${r.url}: ${r.error}`;
    const c = r.commits;
    const during = c.inWindow !== undefined ? `, ${c.beforeWindow} before / ${c.inWindow} during / ${c.afterWindow} after the event` : "";
    return `  repo     ${r.fullName}: created ${r.createdAt?.slice(0, 10) ?? "?"}, ${c.sampled}${c.complete ? "" : "+"} commits by ${c.authors.length} author(s)${during}`;
  });
  return [
    `Scanned "${result.name}" -> ${dir}${result.mode === "preflight" ? " (pre-flight: your own project)" : ""}`,
    `  live     ${result.live ? `${result.live} (HTTP ${result.liveStatus || "unreachable"})` : "none found: pass --live <url>"}`,
    ...repoLines,
    ...result.videos.slice(0, 2).map((v) => `  video    ${v}`),
    ...useCaseSummary(result),
    ...(result.injectionHints.length ? result.injectionHints.map((h) => `  FLAG     possible prompt injection: ${h}`) : []),
    "",
    `Next: read ${dir}/submission.md (untrusted data), list the claims a user could check in the live demo, and write one Kane flow per claim in ${dir}/flows/.`,
  ].join("\n");
}

/** `kane-judge scan <urls…>`: collect what a submission claims and where it runs. Runs none of its code. */
export async function scanCommand(args: ScanArgs): Promise<number> {
  const problems = scanArgProblems(args);
  if (problems.length) {
    out(`kane-judge scan: ${problems.join("; ")}`);
    return 2;
  }
  const window = args.since || args.until ? { since: args.since, until: args.until } : undefined;
  try {
    const { result, dir } = await scanSubmission({ ...args, window, useCases: args.noUseCases ? undefined : (readme) => extractUseCases(readme) });
    out(describe(result, displayPath(dir)));
    return 0;
  } catch (err) {
    if (!(err instanceof KaneJudgeError)) throw err;
    out(`kane-judge scan: ${err.message}`);
    return 2;
  }
}
