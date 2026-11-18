import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeMessage } from "../shared/errors.js";
import { runCommand } from "../shared/proc.js";

/**
 * A use-case Kane itself found in a README (`kane-cli context ingest` +
 * `context extract`). The list is the denominator of a scorecard: every
 * use-case has to be covered by a claim, tested or not, so a verdict can't
 * quietly test only the promises that hold.
 */
export interface KaneUseCase {
  /** u1, u2, … in the order Kane proposed them. */
  id: string;
  title: string;
  /** Kane's risk rating: high | med | low. */
  risk?: string;
  /** Where the README says it, as Kane cites it: "L12-L14". */
  anchor?: string;
  /** The README lines behind the anchor. */
  quote?: string;
}

export interface UseCaseResult {
  useCases: KaneUseCase[];
  /** Why the list is empty, when Kane could not be asked. */
  note?: string;
}

const QUOTE_LIMIT = 300;
const MAX_USE_CASES = 40;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** The README lines an anchor like "L12-L14" points at, on one line. */
export function quoteFor(readme: string, anchor: string | undefined): string | undefined {
  const match = /^L(\d+)(?:-L?(\d+))?$/.exec(anchor ?? "");
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = Math.max(from, Number(match[2] ?? match[1]));
  const lines = readme.split(/\r?\n/).slice(from - 1, Math.min(to, from + 5));
  const quote = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!quote) return undefined;
  return quote.length > QUOTE_LIMIT ? `${quote.slice(0, QUOTE_LIMIT - 1)}…` : quote;
}

/** Reads the `plan` events of `kane-cli context extract --json --plan`: the use-cases Kane proposes, nothing saved. */
export function parseUseCasePlan(stdout: string, readme: string): KaneUseCase[] {
  const found: KaneUseCase[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(event) || event.type !== "plan" || !Array.isArray(event.use_cases)) continue;
    for (const raw of event.use_cases) {
      const title = isObject(raw) ? text(raw.title) : undefined;
      if (!isObject(raw) || !title || found.length >= MAX_USE_CASES) continue;
      const anchor = text(raw.anchor);
      found.push({ id: `u${found.length + 1}`, title, risk: text(raw.risk), anchor, quote: quoteFor(readme, anchor) });
    }
  }
  return found;
}

/**
 * Asks Kane which use-cases a README promises. Runs in a throwaway folder with
 * `--local` and `--plan`, so nothing is saved to the user's Test Manager or
 * project. About half a minute and two credits. Best effort: any problem
 * yields an empty list and a note, never a failed scan.
 */
export async function extractUseCases(readme: string, kaneBin = "kane-cli"): Promise<UseCaseResult> {
  const dir = await mkdtemp(join(tmpdir(), "kane-judge-usecases-"));
  try {
    await writeFile(join(dir, "README.md"), readme, "utf8");
    const opts = { cwd: dir, killGraceMs: 2_000 };
    const added = await runCommand(kaneBin, ["context", "ingest", "README.md", "--mode", "ci", "--local"], { ...opts, timeoutMs: 60_000 });
    if (added.spawnError) return { useCases: [], note: "Kane CLI is not installed, so Kane was not asked for the README's use-cases." };
    if (added.exitCode !== 0) return { useCases: [], note: `Kane could not read the README (kane-cli context ingest exited ${added.exitCode ?? "on a signal"}).` };
    const plan = await runCommand(kaneBin, ["context", "extract", "--mode", "override", "--json", "--plan"], { ...opts, timeoutMs: 150_000 });
    const useCases = parseUseCasePlan(plan.stdout, readme);
    if (useCases.length) return { useCases };
    return { useCases: [], note: plan.timedOut ? "Kane took too long to find the README's use-cases." : "Kane found no use-cases in the README." };
  } catch (err) {
    return { useCases: [], note: `Kane was not asked for the README's use-cases: ${safeMessage(err)}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
