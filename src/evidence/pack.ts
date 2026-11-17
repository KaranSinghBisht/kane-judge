import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { safeMessage } from "../shared/errors.js";
import { pathExists } from "../shared/fs.js";
import { log } from "../shared/logger.js";
import { forStep, isProblem, parseConsoleLog, parseNetworkFailures, type ConsoleEntry, type NetworkFailure } from "./logs.js";
import { ZipReader } from "./zip.js";

export interface StepEvidence {
  packPath: string;
  testDir?: string;
  stepDir?: string;
  error?: string;
  pageUrl?: string;
  pageTitle?: string;
  triage?: { rootCause?: string; suggestedFix?: string };
  console: ConsoleEntry[];
  network: NetworkFailure[];
  /** Zip entry of the failing step's screenshot (annotated when available). */
  screenshotEntry?: string;
  /** Where the screenshot was extracted to, when requested. */
  screenshotPath?: string;
}

export interface PackTarget {
  testId?: string;
  /** Contents of the flow file, used to find its test inside a multi-test pack. */
  flowText?: string;
  /** Extract the failing step's screenshot to this path. */
  screenshotTo?: string;
}

/** Finds the evidence pack for a run: Kane's stderr hint, then the execution id, then the newest pack. */
export async function locatePack(
  projectDir: string,
  opts: { hinted?: string; executionId?: string; sinceMs?: number },
): Promise<string | undefined> {
  if (opts.hinted && (await pathExists(opts.hinted))) return opts.hinted;
  const store = join(projectDir, ".testmuai", "evidence");
  if (opts.executionId) {
    const byId = join(store, `${opts.executionId}.evidence`);
    if (await pathExists(byId)) return byId;
  }
  let names: string[];
  try {
    names = (await readdir(store)).filter((n) => n.endsWith(".evidence"));
  } catch {
    return undefined;
  }
  const dated = await Promise.all(names.map(async (n) => ({ n, m: (await stat(join(store, n))).mtimeMs })));
  const fresh = dated.filter((d) => d.m >= (opts.sinceMs ?? 0)).sort((a, b) => b.m - a.m);
  return fresh[0] ? join(store, fresh[0].n) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Reads the first string found along any of the given key paths. */
export function pick(root: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    let cur: unknown = root;
    for (const key of path) cur = asRecord(cur)?.[key];
    if (typeof cur === "string" && cur.trim() !== "") return cur.trim();
  }
  return undefined;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

function testDirs(zip: ZipReader): string[] {
  const dirs = new Set<string>();
  for (const name of zip.names) {
    const m = /^tests\/([^/]+)\//.exec(name);
    if (m) dirs.add(`tests/${m[1]}`);
  }
  return [...dirs];
}

function pickTestDir(zip: ZipReader, target: PackTarget): string | undefined {
  const dirs = testDirs(zip);
  if (target.testId && dirs.includes(`tests/${target.testId}`)) return `tests/${target.testId}`;
  if (dirs.length <= 1) return dirs[0];
  if (!target.flowText) return undefined;
  const wanted = normalize(target.flowText);
  return dirs.find((d) => {
    const text = zip.readText(`${d}/test.md`);
    return text !== undefined && (normalize(text) === wanted || wanted.includes(normalize(text)));
  });
}

function failingStepDir(zip: ZipReader, testDir: string): string | undefined {
  const failures = zip.names
    .filter((n) => n.startsWith(`${testDir}/steps/`) && n.endsWith("/failure.yaml"))
    .map((n) => dirname(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return failures[failures.length - 1];
}

/** "steps/0007-abc" -> ["7", "0007", "abc", "0007-abc"]: the keys logs may use to attribute entries. */
function stepKeys(stepDir: string | undefined): string[] {
  if (!stepDir) return [];
  const base = stepDir.split("/").pop() ?? "";
  const m = /^(\d+)-(.+)$/.exec(base);
  return m ? [String(Number(m[1])), m[1] ?? "", m[2] ?? "", base] : [base];
}

function readFailureYaml(zip: ZipReader, stepDir: string, ev: StepEvidence): void {
  const text = zip.readText(`${stepDir}/failure.yaml`);
  if (!text) return;
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    log.debug(`failure.yaml unreadable: ${safeMessage(err)}`);
    return;
  }
  ev.error = pick(doc, [["error", "message"], ["error"], ["message"], ["reason"]]);
  ev.pageUrl = pick(doc, [["page_state", "url"], ["page", "url"], ["url"]]);
  ev.pageTitle = pick(doc, [["page_state", "title"], ["page", "title"]]);
  const rootCause = pick(doc, [["triage", "rca", "root_cause"], ["triage", "root_cause"], ["rca", "root_cause"]]);
  const suggestedFix = pick(doc, [["triage", "suggested_fix", "summary"], ["triage", "suggested_fix"]]);
  if (rootCause || suggestedFix) ev.triage = { rootCause, suggestedFix };
}

function readLogs(zip: ZipReader, testDir: string, keys: string[], ev: StepEvidence): void {
  const logNames = zip.names.filter((n) => n.startsWith(`${testDir}/logs/`));
  const consoleNames = logNames.filter((n) => n.endsWith("-console.ndjson"));
  const harNames = logNames.filter((n) => n.endsWith("-network.har"));
  const files = zip.readBytes([...consoleNames, ...harNames]);
  const decoder = new TextDecoder();
  const consoleEntries = consoleNames.flatMap((n) => parseConsoleLog(decoder.decode(files.get(n))));
  const network = harNames.flatMap((n) => parseNetworkFailures(decoder.decode(files.get(n))));
  ev.console = forStep(consoleEntries.filter(isProblem), keys, 8);
  ev.network = forStep(network, keys, 8);
}

/** Pulls the failing step's facts out of a sealed evidence pack. Best effort: missing parts stay empty. */
export async function readFailureEvidence(packPath: string, target: PackTarget): Promise<StepEvidence | undefined> {
  let zip: ZipReader;
  try {
    zip = await ZipReader.open(packPath);
  } catch (err) {
    log.warn(`could not open evidence pack ${packPath}: ${safeMessage(err)}`);
    return undefined;
  }
  const ev: StepEvidence = { packPath, console: [], network: [] };
  const testDir = pickTestDir(zip, target);
  if (!testDir) return ev;
  ev.testDir = testDir;
  ev.stepDir = failingStepDir(zip, testDir);
  if (ev.stepDir) {
    readFailureYaml(zip, ev.stepDir, ev);
    ev.screenshotEntry = ["annotated.png", "screenshot.png"].map((f) => `${ev.stepDir}/${f}`).find((n) => zip.has(n));
  }
  readLogs(zip, testDir, stepKeys(ev.stepDir), ev);
  if (ev.screenshotEntry && target.screenshotTo) {
    ev.screenshotPath = (await writeEntry(zip, ev.screenshotEntry, target.screenshotTo)) ? target.screenshotTo : undefined;
  }
  return ev;
}

/** Extracts the last step's screenshot: proof of where a passing flow ended up. */
export async function readProofScreenshot(packPath: string, target: PackTarget & { screenshotTo: string }): Promise<string | undefined> {
  let zip: ZipReader;
  try {
    zip = await ZipReader.open(packPath);
  } catch (err) {
    log.warn(`could not open evidence pack ${packPath}: ${safeMessage(err)}`);
    return undefined;
  }
  const testDir = pickTestDir(zip, target);
  if (!testDir) return undefined;
  const shots = zip.names
    .filter((n) => n.startsWith(`${testDir}/steps/`) && n.endsWith("/screenshot.png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const last = shots[shots.length - 1];
  if (!last) return undefined;
  return (await writeEntry(zip, last, target.screenshotTo)) ? target.screenshotTo : undefined;
}

async function writeEntry(zip: ZipReader, entry: string, destination: string): Promise<boolean> {
  const bytes = zip.readBytes([entry]).get(entry);
  if (!bytes) return false;
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return true;
  } catch (err) {
    log.warn(`could not write ${destination}: ${safeMessage(err)}`);
    return false;
  }
}
