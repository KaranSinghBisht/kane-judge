import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stopReason } from "../src/cli/commands/hook.js";
import { pendingProjects, RUN_MARKER } from "../src/judge/pending.js";
import { resultsStamp, type KaneResults } from "../src/judge/results.js";
import { renderScorecard } from "../src/judge/scorecard.js";
import type { Verdict } from "../src/judge/verdict.js";
import { useTempDirs, writeTree } from "./helpers/tmp.js";

const makeDir = useTempDirs();
const NOW = Date.parse("2026-11-18T10:00:00Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

function results(...runAges: number[]): KaneResults {
  return { version: 1, runs: runAges.map((age) => ({ at: minutesAgo(age), flows: ["01-promo"], outcome: "failed" as const, durationS: 30 })), flows: {} };
}

const VERDICT: Verdict = { version: 1, project: { name: "Shop", slug: "shop" }, summary: "s", claims: [], scores: [], questions: [], flags: [] };
const scorecardFor = (r: KaneResults) => renderScorecard({ verdict: VERDICT, results: r, images: new Map() });

describe("pendingProjects: Kane has answered and no scorecard holds the answer yet", () => {
  it("names a project whose recent run has no scorecard", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(results(2)) });
    expect(await pendingProjects(ws, NOW)).toEqual(["projects/shop"]);
  });

  it("names a project whose scorecard was built before the latest run, and clears it once the report is rebuilt", async () => {
    const ws = await makeDir();
    const before = results(10);
    const after = results(10, 2);
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(after), "projects/shop/scorecard.html": scorecardFor(before) });
    expect(await pendingProjects(ws, NOW)).toEqual(["projects/shop"]);
    await writeTree(ws, { "projects/shop/scorecard.html": scorecardFor(after) });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
  });

  it("goes by what the files say, not by their timestamps (a copied folder is still up to date)", async () => {
    const ws = await makeDir();
    const r = results(5);
    // The scorecard is written first, so the results file is the newer one on disk.
    await writeTree(ws, { "projects/shop/scorecard.html": scorecardFor(r) });
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(r) });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
  });

  it("leaves old work alone, and a folder with no projects or unreadable results", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/old/kane-results.json": JSON.stringify(results(90)), "projects/bad/kane-results.json": "{not json" });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
    expect(await pendingProjects(await makeDir(), NOW)).toEqual([]);
  });

  it("doesn't interrupt while Kane is still running in the project", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(results(5)), [`projects/shop/${RUN_MARKER}`]: JSON.stringify({ pid: 1, startedAt: NOW - 60_000 }) });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
  });

  it("ignores a run marker left behind by a run that died long ago", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(results(5)), [`projects/shop/${RUN_MARKER}`]: JSON.stringify({ pid: 1, startedAt: NOW - 45 * 60_000 }) });
    expect(await pendingProjects(ws, NOW)).toEqual(["projects/shop"]);
  });
});

describe("resultsStamp", () => {
  it("changes with every new Kane run and is written into the scorecard", () => {
    expect(resultsStamp(results(10))).not.toBe(resultsStamp(results(10, 2)));
    expect(resultsStamp(results(10))).toBe(resultsStamp(results(10)));
    expect(scorecardFor(results(10))).toContain(`<meta name="kane-judge-results" content="${resultsStamp(results(10))}">`);
  });
});

describe("stopReason", () => {
  it("tells the agent how to close the loop, and how to stop honestly when it can't", () => {
    const reason = stopReason(["projects/shop"]);
    expect(reason).toContain("projects/shop");
    expect(reason).toContain("kane-judge report");
    expect(reason).toContain("say exactly what is still open");
  });
});
