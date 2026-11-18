import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZipReader } from "../evidence/zip.js";
import { relativeInside } from "../shared/fs.js";
import type { KaneResults, RunRecord } from "./results.js";

/** What re-reading Kane's sealed evidence packs found when the report was built. */
export interface PackCheck {
  /** Runs whose pack was on disk, matched its recorded hash and agreed with the recorded statuses. */
  verified: number;
  /** Of the verified runs, those whose pack is a share copy (`kane-judge share`), not the file Kane sealed. */
  shared: number;
  /** Runs that recorded a pack which is no longer on disk. */
  missing: number;
  problems: string[];
}

/** Statuses Kane Judge assigns itself; the pack has no word for them. */
const OWN_STATUSES = new Set(["no-steps"]);

/** The status in `tests/<flow>-<8 hex>/result.yaml` for each flow of the run that the pack holds. */
function packStatuses(zip: ZipReader, flows: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const flow of flows) {
    const stem = flow.split("/").pop() ?? flow;
    // Kane names a test's folder after its file: "<stem>-<8 hex digits>".
    const entry = zip.names.find((n) => n.startsWith(`tests/${stem}-`) && /^-[0-9a-f]{8}\/result\.yaml$/.test(n.slice(6 + stem.length)));
    const text = entry ? zip.readText(entry) : undefined;
    if (!text) continue;
    try {
      const status = (parseYaml(text) as { status?: unknown } | null)?.status;
      if (typeof status === "string") found.set(flow, status);
    } catch {
      // An unreadable result.yaml leaves that flow unverified rather than failing the report.
    }
  }
  return found;
}

async function verifyRun(projectDir: string, run: RunRecord, results: KaneResults, check: PackCheck): Promise<void> {
  const rel = run.evidencePath ? relativeInside(projectDir, run.evidencePath) : undefined;
  if (!rel) return;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(resolve(projectDir, rel)));
  } catch {
    check.missing += 1;
    return;
  }
  const when = run.at.slice(0, 16).replace("T", " ");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const isShareCopy = run.sharedPackSha256 !== undefined && digest === run.sharedPackSha256;
  if (run.packSha256 && digest !== run.packSha256 && !isShareCopy) {
    check.problems.push(`the evidence pack of Kane's run at ${when} UTC is not the file Kane sealed (its hash changed). Run the flows again.`);
    return;
  }
  let statuses: Map<string, string>;
  try {
    statuses = packStatuses(ZipReader.fromBytes(bytes), run.flows);
  } catch {
    check.problems.push(`the evidence pack of Kane's run at ${when} UTC can't be opened. Run the flows again.`);
    return;
  }
  for (const [flow, sealed] of statuses) {
    const recorded = results.flows[flow]?.history?.find((h) => h.at === run.at)?.status;
    if (recorded && !OWN_STATUSES.has(recorded) && recorded !== sealed) {
      check.problems.push(`kane-results.json says ${flow} ${recorded} in the run at ${when} UTC, but Kane's sealed evidence pack says ${sealed}. The results file doesn't match Kane's evidence.`);
    }
  }
  check.verified += 1;
  if (isShareCopy) check.shared += 1;
}

/**
 * Re-reads every sealed evidence pack the results point at: the file must hash
 * to what was recorded right after the run, and each flow's status in the pack
 * must match the recorded one. So kane-results.json can't say more than Kane's
 * sealed evidence does while the packs are there.
 */
export async function verifyPacks(projectDir: string, results: KaneResults | undefined): Promise<PackCheck> {
  const check: PackCheck = { verified: 0, shared: 0, missing: 0, problems: [] };
  for (const run of results?.runs ?? []) await verifyRun(projectDir, run, results ?? { version: 1, runs: [], flows: {} }, check);
  return check;
}
