import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFailureEvidence, readProofScreenshot, withEntryExtension } from "../src/evidence/pack.js";
import { consoleLog, writePack } from "./helpers/pack.js";
import { must, useTempDirs } from "./helpers/tmp.js";

/** JPEG magic bytes: Kane CLI 0.10.5 writes step screenshots as screenshot.jpg. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 7, 7]);

/** The failure.yaml Kane CLI 0.10.5 sealed for the sample's order-history claim (trimmed). */
const REAL_FAILURE = `step: 0-2
status: broken
error:
  message: Checked shop and checkout pages; neither exposes an Account area or Orders link.
page_state:
  url: http://localhost:4173/checkout.html
  screenshot: steps/2-0-2/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-2
title: Orders workflow assumes a nonexistent Account area
triage:
  status: triaged
  rca:
    root_cause: The test started from the wrong assumption that the shop includes an Account area with past orders.
    category: automation_bug/state_transition_bug
    confidence: 0.96
  severity: major
  suggested_fix:
    summary: Update the test objective for this shop.
`;

/** A merged testrun pack laid out like Kane CLI 0.10.5's: <ordinal>-<run>-<step> step dirs, JPEG shots. */
function realPack() {
  return {
    "run.yaml": "evidence: '0.1'\nstatus: finalized\n",
    "tests/01-browse-871b39bd/test.md": "# Browse\n\n## See the products\nOpen the shop.\n",
    "tests/01-browse-871b39bd/steps/1-0-1/screenshot.jpg": JPEG,
    "tests/01-browse-871b39bd/steps/2-0-2/annotated.png": PNG,
    "tests/01-browse-871b39bd/steps/2-0-2/screenshot.jpg": JPEG,
    "tests/01-browse-871b39bd/steps/10-1-4/screenshot.jpg": Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 0]),
    "tests/04-order-history-60ae1b61/test.md": "# Orders\n\n## Open the order history\nOpen Account.\n",
    "tests/04-order-history-60ae1b61/steps/1-0-1/screenshot.jpg": JPEG,
    "tests/04-order-history-60ae1b61/steps/2-0-2/failure.yaml": REAL_FAILURE,
    "tests/04-order-history-60ae1b61/steps/2-0-2/screenshot.jpg": JPEG,
    "tests/04-order-history-60ae1b61/logs/0-console.ndjson": consoleLog([
      { marker: "step", step: "0-1", ordinal: 1 },
      { sequence: 0, level: "error", text: "Failed to load resource: 404", url: "http://localhost:4173/favicon.ico", step: "0-1" },
      { sequence: 1, level: "warning", text: "[experiments] limit-rows removed 1 of 4 rows", url: "http://localhost:4173/js/experiments.js", step: "0-2" },
    ]),
  };
}

const makeDir = useTempDirs();

describe("Kane CLI 0.10.5 evidence layout", () => {
  it("keeps the source image extension when extracting", () => {
    expect(withEntryExtension("/out/flow-step-2.png", "tests/x/steps/2-0-2/screenshot.jpg")).toBe("/out/flow-step-2.jpg");
    expect(withEntryExtension("/out/flow-pass.png", "tests/x/steps/1/annotated.png")).toBe("/out/flow-pass.png");
  });

  it("extracts the last step's JPEG as proof for a passing flow (numeric step order)", async () => {
    const dir = await makeDir();
    const pack = await writePack(dir, realPack());
    const out = must(await readProofScreenshot(pack, { testId: "01-browse-871b39bd", screenshotTo: join(dir, "01-browse-pass.png") }));
    expect(out).toBe(join(dir, "01-browse-pass.jpg"));
    expect([...(await readFile(out))]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 0]);
  });

  it("reads the real failure record: error, page, triage category/confidence/severity, JPEG screenshot", async () => {
    const dir = await makeDir();
    const pack = await writePack(dir, realPack());
    const ev = must(await readFailureEvidence(pack, { testId: "04-order-history-60ae1b61", screenshotTo: join(dir, "orders-step-2.png") }));
    expect(ev.error).toContain("neither exposes an Account area");
    expect(ev.pageUrl).toBe("http://localhost:4173/checkout.html");
    expect(ev.triage).toMatchObject({ category: "automation_bug/state_transition_bug", confidence: 0.96, severity: "major" });
    expect(ev.triage?.title).toBe("Orders workflow assumes a nonexistent Account area");
    expect(ev.screenshotPath).toBe(join(dir, "orders-step-2.jpg"));
  });

  it("attributes console entries by Kane's run-step ids and drops favicon noise", async () => {
    const dir = await makeDir();
    const pack = await writePack(dir, realPack());
    const ev = must(await readFailureEvidence(pack, { testId: "04-order-history-60ae1b61" }));
    expect(ev.console.map((c) => c.text)).toEqual(["[experiments] limit-rows removed 1 of 4 rows"]);
  });
});
