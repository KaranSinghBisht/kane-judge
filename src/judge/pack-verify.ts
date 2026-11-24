import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZipReader } from "../evidence/zip.js";
import type { Verdict } from "./verdict.js";
import { flowFor } from "./scorecard.js";
import { relativeInside } from "../shared/fs.js";
import { fixProof, type KaneResults, type RunRecord } from "./results.js";

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
function packStatuses(zip: ZipReader, flows: string[], problems: string[]) {
  const found = new Map<string, { status: string; asserts: number; passed: number; sourceSha?: string }>();
  const entries = new Map<string, string>();
  for (const name of zip.names) {
    const stem = /^tests\/([^/]+)-[0-9a-f]{8}\/result\.yaml$/.exec(name)?.[1];
    if (!stem) continue;
    if (entries.has(stem)) problems.push(`The evidence pack has more than one result for ${stem}.`);
    entries.set(stem, name);
  }
  const expected = new Set(flows.map(flow => flow.split("/").pop()));
  if (expected.size !== flows.length || entries.size !== expected.size) {
    problems.push("The members in the evidence pack differ from the recorded flow list.");
  }
  for (const flow of flows) {
    const stem = flow.split("/").pop() ?? flow;
    const entry = entries.get(stem);
    const text = entry ? zip.readText(entry) : undefined;
    if (!text) continue;
    try {
      const doc = parseYaml(text) as { status?: unknown; steps?: Array<{ kind?: string; status?: string }> } | null;
      if (typeof doc?.status !== "string" || !Array.isArray(doc.steps)) continue;
      const asserts = doc.steps.filter(s => s?.kind === "assert");
      const source = entry && zip.readText(entry.replace(/result\.yaml$/, "test.md"));
      const sourceSha = source ? createHash("sha256").update(source).digest("hex") : undefined;
      found.set(flow, { sourceSha, status: doc.status, asserts: asserts.length, passed: asserts.filter(s => s.status === "passed").length });
    } catch {
      // The caller refuses missing or unreadable members; it never counts them as verified.
    }
  }
  return found;
}

async function verifyRun(projectDir: string, run: RunRecord, results: KaneResults, check: PackCheck, sources: Map<string, Map<string, string>>): Promise<void> {
  const rel = run.evidencePath ? relativeInside(projectDir, run.evidencePath) : undefined;
  const when = run.at.slice(0, 16).replace("T", " ");
  if (run.outcome === "error" || run.outcome === "timeout") return;
  if (!rel) {
    check.problems.push(`Kane's run at ${when} UTC has no evidence pack inside the project. Restore the pack or run the flows again.`);
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(resolve(projectDir, rel)));
  } catch {
    check.missing += 1;
    check.problems.push(`the evidence pack of Kane's run at ${when} UTC is missing. Restore it or run the flows again; recorded JSON alone cannot prove a claim.`);
    return;
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const isShareCopy = run.sharedPackSha256 !== undefined && digest === run.sharedPackSha256;
  if (!run.packSha256) {
    check.problems.push(`Kane's run at ${when} UTC has no recorded evidence hash. Run the flows again.`);
    return;
  }
  if (run.packSha256 && digest !== run.packSha256 && !isShareCopy) {
    check.problems.push(`the evidence pack of Kane's run at ${when} UTC is not the file Kane sealed (its hash changed). Run the flows again.`);
    return;
  }
  const before = check.problems.length;
  let statuses: ReturnType<typeof packStatuses>;
  try {
    statuses = packStatuses(ZipReader.fromBytes(bytes), run.flows, check.problems);
  } catch {
    check.problems.push(`the evidence pack of Kane's run at ${when} UTC can't be opened. Run the flows again.`);
    return;
  }
  if (run.kaneVerdict?.packSha256 && run.kaneVerdict.packSha256 !== run.packSha256) {
    check.problems.push(`Kane's policy verdict at ${when} UTC belongs to a different evidence pack.`);
  }
  if (run.kaneVerdict?.result === "pass" && [...statuses.values()].some(s => s.status !== "passed")) {
    check.problems.push(`Kane's recorded policy verdict says pass at ${when} UTC, but the evidence pack contains a flow that did not pass.`);
  }
  for (const flow of run.flows) {
    const sealed = statuses.get(flow);
    const current = results.flows[flow];
    const history = current?.history?.find((h) => h.at === run.at);
    if (!sealed || !history) {
      check.problems.push(`${flow} has no readable result in Kane's evidence pack or no matching run history at ${when} UTC. Run it again.`);
      continue;
    }
    for (const recorded of [history, ...(current?.lastRunAt === run.at ? [current] : [])]) {
      if (!OWN_STATUSES.has(recorded.status) && recorded.status !== sealed.status) {
        check.problems.push(`kane-results.json says ${flow} ${recorded.status} in the run at ${when} UTC, but Kane's sealed evidence pack says ${sealed.status}. The results file doesn't match Kane's evidence.`);
      }
    }
    if (history.asserts !== undefined && history.asserts !== sealed.passed) {
      check.problems.push(`${flow}'s assertion count in its history disagrees with Kane's evidence pack at ${when} UTC.`);
    }
    if (current?.lastRunAt === run.at && current.asserts && (current.asserts.total !== sealed.asserts || current.asserts.passed !== sealed.passed)) {
      check.problems.push(`${flow}'s current assertion counts disagree with Kane's evidence pack at ${when} UTC.`);
    }
  }
  if (check.problems.length === before) {
    const hashes = new Map<string, string>();
    for (const [flow, result] of statuses) if (result.sourceSha) hashes.set(flow, result.sourceSha);
    sources.set(run.at, hashes);
    check.verified += 1;
    if (isShareCopy) check.shared += 1;
  }
}

/**
 * Re-reads every sealed evidence pack the results point at: the file must hash
 * to what was recorded right after the run, and each flow's status in the pack
 * must match the recorded one. So kane-results.json can't say more than Kane's
 * sealed evidence does while the packs are there.
 */
export async function verifyPacks(projectDir: string, results: KaneResults | undefined, verdict?: Verdict): Promise<PackCheck> {
  const check: PackCheck = { verified: 0, shared: 0, missing: 0, problems: [] };
  if (!results) return check;
  const sources = new Map<string, Map<string, string>>();
  const completed = results.runs.filter(run => run.outcome === "passed" || run.outcome === "failed");
  if (new Set(results.runs.map(run => run.at)).size !== results.runs.length) {
    check.problems.push("Recorded runs have duplicate timestamps. Run history must identify a single run per entry.");
  }
  for (const flow of Object.values(results.flows)) {
    const expected = completed.filter(run => run.flows.includes(flow.name)).map(run => run.at);
    const history = flow.history ?? [];
    if (!expected.length || flow.lastRunAt !== expected.at(-1) || expected.length !== history.length || history.some((entry, i) => entry.at !== expected[i])) {
      check.problems.push(`${flow.name}'s history or current result does not match its completed Kane runs in order. Restore the recorded history.`);
    }
  }
  for (const run of results.runs) await verifyRun(projectDir, run, results, check, sources);
  for (const claim of verdict?.claims ?? []) {
    if (!claim.fix || claim.status !== "proven") continue;
    const flow = flowFor(claim, results);
    const proof = flow && fixProof(results, flow);
    if (!proof || !flow) continue; // The verdict checker reports a missing failure or pass.
    const before = sources.get(proof.anchorAt)?.get(proof.anchorFlow);
    const after = sources.get(proof.passedAt)?.get(flow.name);
    const shownBefore = sources.get(proof.failedAt)?.get(proof.failedFlow);
    if (!before || before !== after || before !== shownBefore) {
      check.problems.push(`${claim.id}: the failing and passing evidence packs must contain the same test.md to establish this fix.`);
    }
  }
  return check;
}
