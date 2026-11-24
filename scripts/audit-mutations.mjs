// A small, deliberate mutation audit of the evidence contract. This is a
// targeted sample, not a claim of whole-project mutation coverage.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mutations = [
  ["failed flow may prove a claim", "src/judge/evidence-check.ts", 'if (flow.status !== "passed") {', 'if (false) {'],
  ["zero assertions may prove a claim", "src/judge/evidence-check.ts", "if (flow.asserts.passed < 1) {", "if (false) {"],
  ["claim may borrow another claim's flow", "src/judge/evidence-check.ts", 'if (flow.claim && flow.claim !== claim.id.toLowerCase()) {', 'if (false) {'],
  ["changed test may prove a fix", "src/judge/results.ts", "if (!anchor?.flowSha || anchor.flowSha !== last.flowSha) return undefined;", "if (!anchor?.flowSha) return undefined;"],
  ["pack hash mismatch is ignored", "src/judge/pack-verify.ts", "if (run.packSha256 && digest !== run.packSha256 && !isShareCopy) {", "if (false) {"],
  ["current status is not compared to sealed evidence", "src/judge/pack-verify.ts", "[history, ...(current?.lastRunAt === run.at ? [current] : [])]", "[history]"],
  ["missing packs are accepted", "src/judge/pack-verify.ts", 'check.problems.push(`the evidence pack of Kane\'s run at ${when} UTC is missing. Restore it or run the flows again; recorded JSON alone cannot prove a claim.`);', "// Missing pack deliberately ignored by this mutation."],
  ["skipped tests may label a product broken", "src/judge/evidence-check.ts", '} else if (flow.status !== "failed") {', '} else if (false) {'],
];
const originals = new Map(mutations.map(([, file]) => [file, readFileSync(file, "utf8")]));
function restore() { for (const [file, text] of originals) writeFileSync(file, text); }
process.on("exit", restore);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
const temp = mkdtempSync(join(tmpdir(), "kane-mutations-"));
const report = join(temp, "results.json");
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
const testArgs = ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${report}`];
const test = () => { rmSync(report, { force: true }); return spawnSync(process.execPath, testArgs, { encoding: "utf8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }); };
if (test().status !== 0) throw new Error("The baseline must pass before a mutation audit.");
const results = [];
try {
  for (const [name, file, before, after] of mutations) {
    const source = originals.get(file);
    if (!source?.includes(before)) throw new Error(`Mutation no longer matches: ${name}`);
    writeFileSync(file, source.replace(before, after));
    const result = test();
    let failedTests = [];
    try {
      const json = JSON.parse(readFileSync(report, "utf8"));
      failedTests = json.testResults.flatMap(t => t.assertionResults.filter(a => a.status === "failed").map(a => a.fullName));
    } catch { /* A tool failure is an error, never a killed mutation. */ }
    const killed = result.status !== 0 && failedTests.length > 0;
    results.push({ name, file, killed, failedTests, ...(result.error ? { error: result.error.message } : {}) });
    console.log(`${killed ? "CAUGHT" : "SURVIVED/ERROR"}: ${name} (${failedTests.length} failing tests)`);
    writeFileSync(file, source);
  }
} finally { restore(); }
mkdirSync("docs/audit", { recursive: true });
writeFileSync("docs/audit/mutation-results.json", JSON.stringify({ scope: "Eight deliberate evidence-contract mutations; not a whole-project mutation score", results }, null, 2) + "\n");
process.exitCode = results.every(r => r.killed) ? 0 : 1;
