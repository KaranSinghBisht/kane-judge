import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../src/cli/commands/report.js";
import { checkAgainstKane } from "../src/judge/evidence-check.js";
import { emptyResults, fixProof, mergeRun, type KaneResults } from "../src/judge/results.js";
import type { Verdict } from "../src/judge/verdict.js";
import { checkVerdict } from "../src/judge/verdict-check.js";
import { projectPaths } from "../src/judge/workspace.js";
import { must, useTempDirs } from "./helpers/tmp.js";

const makeDir = useTempDirs();
const example = join(import.meta.dirname, "../examples/judged/inkwell-shop");

// These are edits to a real Kane run, checked through the same public boundary
// as `report`. No mocked runner or synthetic assertion counts.
async function recorded() {
  const dir = await makeDir();
  for (const name of ["scan.json", "verdict.json", "kane-results.json", "packs", "flows"]) {
    await cp(join(example, name), join(dir, name), { recursive: true });
  }
  const results = JSON.parse(await readFile(join(dir, "kane-results.json"), "utf8")) as KaneResults;
  const verdict = JSON.parse(await readFile(join(dir, "verdict.json"), "utf8")) as Verdict;
  const save = async () => {
    await writeFile(join(dir, "kane-results.json"), JSON.stringify(results));
    await writeFile(join(dir, "verdict.json"), JSON.stringify(verdict));
  };
  return { dir, paths: projectPaths(dir), results, verdict, save };
}

describe("report boundary against a real recorded Kane pack", () => {
  it("accepts the unmodified run", async () => {
    const r = await recorded();
    expect((await checkProject(r.paths)).ok).toBe(true);
  });

  it("refuses a failed flow relabelled passed only in the current result", async () => {
    const r = await recorded();
    const claim = must(r.verdict.claims.find(c => c.id === "c3"));
    const flow = must(r.results.flows["03-apply-promo"]);
    claim.status = "proven";
    flow.status = "passed";
    await r.save();
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("refuses a failed attempt inserted into history without a completed Kane run", async () => {
    const r = await recorded();
    const history = must(must(r.results.flows["01-catalogue-and-cart"]).history);
    history.unshift({ ...must(history[0]), at: "2026-11-12T00:00:00Z", status: "failed" });
    await r.save();
    const result = await checkProject(r.paths);
    expect(result.ok ? [] : result.errors.join()).toContain("completed Kane runs in order");
  });

  it("refuses deleting the pack instead of answering its contradictory evidence", async () => {
    const r = await recorded();
    await rm(join(r.dir, "packs"), { recursive: true });
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("refuses removing the recorded run while keeping its green claims", async () => {
    const r = await recorded();
    r.results.runs = [];
    await r.save();
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("recounts asserts from the pack instead of trusting a JSON assertion count", async () => {
    const r = await recorded();
    must(r.results.flows["01-catalogue-and-cart"]).asserts = { total: 999, passed: 999 };
    await r.save();
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("refuses a newer failed-to-start attempt being hidden by an old green result", async () => {
    const r = await recorded();
    r.results.runs.push({ at: "2026-11-24T10:00:00Z", flows: ["01-catalogue-and-cart"], outcome: "error", durationS: 1, reason: "not signed in" });
    await r.save();
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("refuses malformed scan data instead of silently discarding coverage", async () => {
    const r = await recorded();
    await writeFile(r.paths.scan, '{"version":1,"useCases":null}');
    const result = await checkProject(r.paths);
    expect(result.ok).toBe(false);
  });

  it("reports malformed flow data as invalid input without crashing", async () => {
    const r = await recorded();
    r.results.flows["01-catalogue-and-cart"] = null as never;
    await r.save();
    await expect(checkProject(r.paths)).resolves.toMatchObject({ ok: false });
  });
});

describe("additional record tampering", () => {
  it("refuses a policy pass pasted onto a pack with failed flows", async () => {
    const r = await recorded();
    must(must(r.results.runs[0]).kaneVerdict).result = "pass";
    await r.save();
    const check = await checkProject(r.paths);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.join()).toContain("evidence pack contains a flow that did not pass");
  });

  it("does not silently lose coverage if scan.json is deleted", async () => {
    const r = await recorded();
    await rm(r.paths.scan);
    expect((await checkProject(r.paths)).ok).toBe(false);
  });

  it("resolves a claim's nested flow path without losing its subfolder", async () => {
    const r = await recorded();
    const name = "01-catalogue-and-cart";
    const nested = `shop/${name}`;
    const flow = must(r.results.flows[name]);
    delete r.results.flows[name];
    r.results.flows[nested] = { ...flow, name: nested, file: `flows/${nested}_test.md` };
    for (const run of r.results.runs) run.flows = run.flows.map(n => n === name ? nested : n);
    must(r.verdict.claims.find(c => c.id === "c1")).flow = `flows/${nested}_test.md`;
    await r.save();
    expect((await checkProject(r.paths)).ok).toBe(true);
  });

  it("keeps the original failure anchor after more than thirty retries", async () => {
    const r = await recorded();
    const original = must(r.results.flows["03-apply-promo"]);
    let results = emptyResults();
    for (let i = 0; i < 35; i++) {
      const at = new Date(Date.UTC(2026, 10, 24, 10, i)).toISOString();
      const flow = { ...original, lastRunAt: at, flowSha: i === 0 ? "original-strict-test" : "weakened-test", status: i === 34 ? "passed" : "failed", history: undefined };
      results = mergeRun(results, { at, flows: [flow.name], outcome: "failed", durationS: 1 }, [flow]);
    }
    expect(fixProof(results, must(results.flows[original.name]))).toBeUndefined();
  });

  it("does not claim a product fix from a runner crash followed by a pass", async () => {
    const r = await recorded();
    const original = must(r.results.flows["01-catalogue-and-cart"]);
    const first = { ...original, status: "broken", history: undefined, lastRunAt: "2026-11-24T10:00:00Z" };
    const second = { ...original, status: "passed", history: undefined, lastRunAt: "2026-11-24T10:01:00Z" };
    const results = mergeRun(mergeRun(emptyResults(), { at: first.lastRunAt, flows: [first.name], outcome: "failed", durationS: 1 }, [first]), { at: second.lastRunAt, flows: [second.name], outcome: "passed", durationS: 1 }, [second]);
    expect(fixProof(results, must(results.flows[original.name]))).toBeUndefined();
  });
});

describe("claim semantics", () => {
  it.each(["skipped", "interrupted", "broken", "no-steps", "unknown"])("%s is not evidence of a broken product", async status => {
    const r = await recorded();
    must(r.results.flows["03-apply-promo"]).status = status;
    expect(checkAgainstKane(r.verdict, r.results).join()).toMatch(/failed|unverifiable/i);
  });

  it("refuses duplicate claim ids, including case variants", async () => {
    const r = await recorded();
    must(r.verdict.claims[1]).id = must(r.verdict.claims[0]).id.toUpperCase();
    expect(checkVerdict(r.verdict).ok).toBe(false);
  });
});
