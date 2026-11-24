import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withdrawCommand } from "../src/cli/commands/withdraw.js";
import { discoverFlows } from "../src/flows/discover.js";
import { useTempDirs, writeTree } from "./helpers/tmp.js";

const makeDir = useTempDirs();
const FLOW = "---\nurl: https://shop.example.app/\n---\n\n# Orders\n\n## Find the order\nOpen Account. Verify the order is visibly listed.\n";
const SCAN = JSON.stringify({ version: 1, mode: "preflight", scannedAt: "2026-11-24T10:00:00Z", slug: "shop", name: "Shop", inputs: ["."], repos: [], demoCandidates: [], videos: [], injectionHints: [], pages: [] });

describe("kane-judge withdraw", () => {
  it("moves the flow out of flows/ so runs no longer find it, and keeps the file", async () => {
    const dir = await makeDir();
    await writeTree(dir, { "scan.json": SCAN, "flows/01-browse_test.md": FLOW, "flows/04-order-history_test.md": FLOW });
    expect(await withdrawCommand(dir, "04-order-history")).toBe(0);
    expect((await discoverFlows(dir, "flows")).map((f) => f.name)).toEqual(["01-browse"]);
    expect(await readFile(join(dir, "withdrawn", "04-order-history_test.md"), "utf8")).toBe(FLOW);
  });

  it("accepts the flow's file name or path too", async () => {
    const dir = await makeDir();
    await writeTree(dir, { "scan.json": SCAN, "flows/04-order-history_test.md": FLOW });
    expect(await withdrawCommand(dir, "flows/04-order-history_test.md")).toBe(0);
    expect(await discoverFlows(dir, "flows")).toEqual([]);
  });

  it("refuses to withdraw a judged project's failures", async () => {
    const dir = await makeDir();
    await writeTree(dir, { "scan.json": SCAN.replace('"preflight"', '"judge"'), "flows/04-order-history_test.md": FLOW });
    expect(await withdrawCommand(dir, "04-order-history")).toBe(2);
    expect((await discoverFlows(dir, "flows")).map(f => f.name)).toEqual(["04-order-history"]);
  });

  it("refuses an unknown flow or missing arguments without touching anything", async () => {
    const dir = await makeDir();
    await writeTree(dir, { "flows/01-browse_test.md": FLOW });
    expect(await withdrawCommand(dir, "09-nope")).toBe(2);
    expect(await withdrawCommand(dir, undefined)).toBe(2);
    expect(await withdrawCommand(undefined, "01-browse")).toBe(2);
    expect((await discoverFlows(dir, "flows")).map((f) => f.name)).toEqual(["01-browse"]);
  });
});
