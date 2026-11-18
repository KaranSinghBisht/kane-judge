import { checkAgainstKane, checkCoverage, checkMode, checkScoreEvidence } from "../judge/evidence-check.js";
import type { KaneResults } from "../judge/results.js";
import { renderScorecard } from "../judge/scorecard.js";
import { checkVerdict } from "../judge/verdict-check.js";
import type { ScanResult } from "../scan/types.js";

export interface PlaygroundResult {
  ok: boolean;
  /** Why the verdict was refused: the same messages `kane-judge report` prints. */
  errors: string[];
  /** The scorecard, when the verdict stands on Kane's record. */
  html?: string;
}

/**
 * The checks `kane-judge report` runs on a verdict, for the hosted playground:
 * the same modules, compiled for the browser. The checks that need files on
 * disk (re-hashing Kane's evidence packs, reading the builder's README) only
 * run in the CLI.
 */
export function judge(verdictText: string, results: KaneResults, scan: ScanResult): PlaygroundResult {
  let raw: unknown;
  try {
    raw = JSON.parse(verdictText);
  } catch (err) {
    return { ok: false, errors: [`verdict.json is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`] };
  }
  const checked = checkVerdict(raw);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const errors = [...checkMode(checked.verdict, scan), ...checkAgainstKane(checked.verdict, results), ...checkCoverage(checked.verdict, scan), ...checkScoreEvidence(checked.verdict)];
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], html: renderScorecard({ verdict: checked.verdict, results, scan, images: new Map() }) };
}
