import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { locatePack, pick, readFailureEvidence } from "../src/evidence/pack.js";
import { configureLogger } from "../src/shared/logger.js";
import { SCREENSHOT, consoleLog, failingPack, har, writePack } from "./helpers/pack.js";
import { must, useTempDirs } from "./helpers/tmp.js";

const makeDir = useTempDirs();

beforeAll(() => {
  configureLogger({ stderr: false });
});

describe("pick", () => {
  const doc = { error: { message: "  deep message  " }, flat: "flat value", blank: "   ", num: 4, list: ["x"] };

  it("reads the first string found along the given key paths", () => {
    expect(pick(doc, [["missing"], ["flat"], ["error", "message"]])).toBe("flat value");
  });

  it("follows nested keys and trims the result", () => {
    expect(pick(doc, [["error", "message"]])).toBe("deep message");
  });

  it("skips blank and non-string values", () => {
    expect(pick(doc, [["blank"], ["num"], ["list"], ["flat"]])).toBe("flat value");
  });

  it("returns undefined when nothing matches", () => {
    expect(pick(doc, [["nope"], ["error", "nope"]])).toBeUndefined();
  });

  it("copes with documents that are not objects", () => {
    expect(pick("text", [["a"]])).toBeUndefined();
    expect(pick(null, [["a"]])).toBeUndefined();
    expect(pick([1], [["a"]])).toBeUndefined();
  });

  it("does not walk through strings or arrays", () => {
    expect(pick({ a: "string" }, [["a", "length"]])).toBeUndefined();
    expect(pick({ a: ["x"] }, [["a", "0"]])).toBeUndefined();
  });
});

describe("locatePack", () => {
  async function store(root: string, names: Record<string, Date>): Promise<void> {
    const dir = join(root, ".testmuai", "evidence");
    await mkdir(dir, { recursive: true });
    for (const [name, mtime] of Object.entries(names)) {
      await writeFile(join(dir, name), "zip");
      await utimes(join(dir, name), mtime, mtime);
    }
  }

  const OLD = new Date("2026-01-01T00:00:00Z");
  const NEW = new Date("2026-01-02T00:00:00Z");

  it("returns Kane's hinted path when it exists", async () => {
    const root = await makeDir();
    const hinted = join(root, "elsewhere.evidence");
    await writeFile(hinted, "zip");
    await store(root, { "exec-1.evidence": NEW });
    expect(await locatePack(root, { hinted, executionId: "exec-1" })).toBe(hinted);
  });

  it("ignores a hinted path that does not exist and falls back to the execution id", async () => {
    const root = await makeDir();
    await store(root, { "exec-9.evidence": OLD, "other.evidence": NEW });
    const found = await locatePack(root, { hinted: join(root, "gone.evidence"), executionId: "exec-9" });
    expect(found).toBe(join(root, ".testmuai/evidence/exec-9.evidence"));
  });

  it("finds the pack named after the execution id", async () => {
    const root = await makeDir();
    await store(root, { "exec-1.evidence": OLD, "exec-2.evidence": NEW });
    expect(await locatePack(root, { executionId: "exec-1" })).toBe(join(root, ".testmuai/evidence/exec-1.evidence"));
  });

  it("falls back to the newest pack when the execution id has no pack", async () => {
    const root = await makeDir();
    await store(root, { "a.evidence": OLD, "b.evidence": NEW });
    expect(await locatePack(root, { executionId: "missing" })).toBe(join(root, ".testmuai/evidence/b.evidence"));
  });

  it("picks the newest pack when no hint or id is given", async () => {
    const root = await makeDir();
    await store(root, { "a.evidence": NEW, "b.evidence": OLD, "c.evidence": new Date("2026-01-01T12:00:00Z") });
    expect(await locatePack(root, {})).toBe(join(root, ".testmuai/evidence/a.evidence"));
  });

  it("ignores packs older than sinceMs", async () => {
    const root = await makeDir();
    await store(root, { "old.evidence": OLD });
    expect(await locatePack(root, { sinceMs: NEW.getTime() })).toBeUndefined();
  });

  it("returns a pack that is newer than sinceMs", async () => {
    const root = await makeDir();
    await store(root, { "old.evidence": OLD, "fresh.evidence": NEW });
    expect(await locatePack(root, { sinceMs: OLD.getTime() + 1000 })).toBe(join(root, ".testmuai/evidence/fresh.evidence"));
  });

  it("ignores files that are not evidence packs", async () => {
    const root = await makeDir();
    await store(root, { "notes.txt": NEW, "pack.evidence.tmp": NEW });
    expect(await locatePack(root, {})).toBeUndefined();
  });

  it("returns undefined when there is no evidence store", async () => {
    expect(await locatePack(await makeDir(), { executionId: "exec-1" })).toBeUndefined();
  });
});

describe("readFailureEvidence: a failing run", () => {
  it("finds the test and the failing step", async () => {
    const pack = await writePack(await makeDir(), failingPack());
    const ev = must(await readFailureEvidence(pack, { testId: "t-1" }));
    expect(ev.packPath).toBe(pack);
    expect(ev.testDir).toBe("tests/t-1");
    expect(ev.stepDir).toBe("tests/t-1/steps/0002-abc");
  });

  it("reads the error, page and triage from failure.yaml", async () => {
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), failingPack()), { testId: "t-1" }));
    expect(ev.error).toBe("Expected the order summary to show a Total row");
    expect(ev.pageUrl).toBe("http://localhost:4173/checkout.html");
    expect(ev.pageTitle).toBe("Checkout");
    expect(ev.triage).toEqual({
      rootCause: "The promo handler never recomputes the total",
      suggestedFix: "Recompute the total after applying the code",
    });
  });

  it("keeps the console errors and warnings of the failing step, and nothing else", async () => {
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), failingPack()), { testId: "t-1" }));
    expect(ev.console).toEqual([
      { level: "error", text: "TypeError: Cannot read properties of undefined (reading 'total')", step: "2" },
      { level: "warning", text: "deprecated API", step: "2" },
    ]);
  });

  it("keeps the failed requests of the failing step, and nothing else", async () => {
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), failingPack()), { testId: "t-1" }));
    expect(ev.network).toEqual([
      { method: "POST", url: "http://localhost:4173/api/promo", status: 500, statusText: "Internal Server Error", step: "2" },
    ]);
  });

  it("prefers the annotated screenshot", async () => {
    const files = failingPack({ "tests/t-1/steps/0002-abc/screenshot.png": Uint8Array.from([9, 9, 9]) });
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
    expect(ev.screenshotEntry).toBe("tests/t-1/steps/0002-abc/annotated.png");
  });

  it("falls back to the plain screenshot", async () => {
    const files = failingPack();
    delete files["tests/t-1/steps/0002-abc/annotated.png"];
    files["tests/t-1/steps/0002-abc/screenshot.png"] = Uint8Array.from([9, 9, 9]);
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
    expect(ev.screenshotEntry).toBe("tests/t-1/steps/0002-abc/screenshot.png");
  });

  it("has no screenshot entry when the step has none", async () => {
    const files = failingPack();
    delete files["tests/t-1/steps/0002-abc/annotated.png"];
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
    expect(ev.screenshotEntry).toBeUndefined();
  });

  it("extracts the screenshot byte for byte, creating missing directories", async () => {
    const dir = await makeDir();
    const target = join(dir, "state", "artifacts", "run-1", "checkout-step-2.png");
    const ev = must(await readFailureEvidence(await writePack(dir, failingPack()), { testId: "t-1", screenshotTo: target }));
    expect(ev.screenshotPath).toBe(target);
    expect(new Uint8Array(await readFile(target))).toEqual(SCREENSHOT);
  });

  it("does not extract anything when no target path is given", async () => {
    const dir = await makeDir();
    const ev = must(await readFailureEvidence(await writePack(dir, failingPack()), { testId: "t-1" }));
    expect(ev.screenshotPath).toBeUndefined();
    expect(ev.screenshotEntry).toBeDefined();
  });

  it("leaves screenshotPath unset when the target cannot be written", async () => {
    const dir = await makeDir();
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "i am a file, not a directory");
    const ev = must(await readFailureEvidence(await writePack(dir, failingPack()), { testId: "t-1", screenshotTo: join(blocker, "x.png") }));
    expect(ev.screenshotPath).toBeUndefined();
    expect((await stat(blocker)).isFile()).toBe(true);
  });
});

describe("readFailureEvidence: choosing the test and the step", () => {
  it("returns undefined for a file that is not a readable pack", async () => {
    const dir = await makeDir();
    const bogus = join(dir, "bogus.evidence");
    await writeFile(bogus, "this is not a zip file");
    expect(await readFailureEvidence(bogus, { testId: "t-1" })).toBeUndefined();
  });

  it("returns undefined for a pack that does not exist", async () => {
    expect(await readFailureEvidence(join(await makeDir(), "gone.evidence"), {})).toBeUndefined();
  });

  it("uses the only test in the pack when no id is given", async () => {
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), failingPack()), {}));
    expect(ev.testDir).toBe("tests/t-1");
  });

  it("picks the test by id when the pack holds several", async () => {
    const files = failingPack({
      "tests/t-2/test.md": "# Other\n",
      "tests/t-2/steps/0001-zzz/failure.yaml": "error: other test failed\n",
    });
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-2" }));
    expect(ev.testDir).toBe("tests/t-2");
    expect(ev.error).toBe("other test failed");
  });

  it("picks the test whose test.md matches the flow text when the pack holds several", async () => {
    const files = failingPack({ "tests/t-2/test.md": "# Other flow\n\n## Elsewhere\nGo.\n" });
    const flowText = "---\nurl: http://localhost:4173\n---\n# Other flow\n\n## Elsewhere\nGo.\n";
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { flowText }));
    expect(ev.testDir).toBe("tests/t-2");
  });

  it("matches the flow text regardless of whitespace differences", async () => {
    const files = failingPack({ "tests/t-2/test.md": "# Other\nGo.\n" });
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { flowText: "#   Other\n\n\n  Go." }));
    expect(ev.testDir).toBe("tests/t-2");
  });

  it("returns an empty result when several tests exist and none can be identified", async () => {
    const files = failingPack({ "tests/t-2/test.md": "# Other\n" });
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { flowText: "# Unrelated" }));
    expect(ev).toEqual({ packPath: expect.any(String), console: [], network: [] });
  });

  it("returns an empty result for several tests without an id or flow text", async () => {
    const files = failingPack({ "tests/t-2/test.md": "# Other\n" });
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), {}));
    expect(ev.testDir).toBeUndefined();
  });

  it("takes the numerically last failing step, not the alphabetically last", async () => {
    const files = failingPack({
      "tests/t-1/steps/2-a/failure.yaml": "error: step two\n",
      "tests/t-1/steps/10-b/failure.yaml": "error: step ten\n",
      "tests/t-1/steps/9-c/failure.yaml": "error: step nine\n",
    });
    delete files["tests/t-1/steps/0002-abc/failure.yaml"];
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
    expect(ev.stepDir).toBe("tests/t-1/steps/10-b");
    expect(ev.error).toBe("step ten");
  });

  it("works without any failing step: no step dir, but the logs are still read", async () => {
    const files = failingPack();
    delete files["tests/t-1/steps/0002-abc/failure.yaml"];
    const ev = must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
    expect(ev.stepDir).toBeUndefined();
    expect(ev.error).toBeUndefined();
    expect(ev.console.length).toBeGreaterThan(0);
  });
});

describe("readFailureEvidence: failure.yaml shapes and logs", () => {
  const withYaml = (yaml: string) => failingPack({ "tests/t-1/steps/0002-abc/failure.yaml": yaml });

  async function evidenceFor(files: Record<string, string | Uint8Array>) {
    return must(await readFailureEvidence(await writePack(await makeDir(), files), { testId: "t-1" }));
  }

  it("reads an error written as a plain string", async () => {
    expect((await evidenceFor(withYaml("error: Pay did nothing\n"))).error).toBe("Pay did nothing");
  });

  it.each([
    ["message", "message: top-level message\n"],
    ["reason", "reason: top-level reason\n"],
  ])("reads the error from a top-level %s", async (_key, yaml) => {
    expect((await evidenceFor(withYaml(yaml))).error).toContain("top-level");
  });

  it.each([
    ["page.url", "page:\n  url: http://x/page\n"],
    ["a top-level url", "url: http://x/page\n"],
  ])("reads the page URL from %s", async (_name, yaml) => {
    expect((await evidenceFor(withYaml(yaml))).pageUrl).toBe("http://x/page");
  });

  it("reads triage written without the rca level", async () => {
    const yaml = "triage:\n  root_cause: shortcut cause\n  suggested_fix: shortcut fix\n";
    expect((await evidenceFor(withYaml(yaml))).triage).toEqual({ rootCause: "shortcut cause", suggestedFix: "shortcut fix" });
  });

  it("leaves triage undefined when the yaml has none", async () => {
    expect((await evidenceFor(withYaml("error: x\n"))).triage).toBeUndefined();
  });

  it("copes with a malformed failure.yaml and still reads the logs", async () => {
    const ev = await evidenceFor(withYaml("error: [unclosed\n  : :\n"));
    expect(ev.error).toBeUndefined();
    expect(ev.console).toHaveLength(2);
  });

  it("copes with an empty failure.yaml", async () => {
    expect((await evidenceFor(withYaml(""))).error).toBeUndefined();
  });

  it.each(["2", "0002", "abc", "0002-abc"])("attributes a console entry carrying the step key %s to the failing step", async (key) => {
    const files = failingPack({
      "tests/t-1/logs/0-console.ndjson": consoleLog([
        { level: "error", text: "mine", step: key },
        { level: "error", text: "someone else's", step: "99" },
      ]),
    });
    expect((await evidenceFor(files)).console.map((c) => c.text)).toEqual(["mine"]);
  });

  it("falls back to the most recent problems when the logs carry no step attribution", async () => {
    const records = Array.from({ length: 12 }, (_, i) => ({ level: "error", text: `error ${i}` }));
    const files = failingPack({ "tests/t-1/logs/0-console.ndjson": consoleLog(records) });
    const texts = (await evidenceFor(files)).console.map((c) => c.text);
    expect(texts).toHaveLength(8);
    expect(texts[0]).toBe("error 4");
    expect(texts[7]).toBe("error 11");
  });

  it("combines every console and network log in the test", async () => {
    const files = failingPack({
      "tests/t-1/logs/1-console.ndjson": consoleLog([{ level: "error", text: "from the second log", step: "2" }]),
      "tests/t-1/logs/1-network.har": har([{ request: { method: "GET", url: "http://x/second" }, response: { status: 503 }, step: 2 }]),
    });
    const ev = await evidenceFor(files);
    expect(ev.console.map((c) => c.text)).toContain("from the second log");
    expect(ev.network.map((n) => n.url)).toContain("http://x/second");
  });

  it("reports empty console and network lists when the test has no logs", async () => {
    const files = failingPack();
    for (const name of Object.keys(files)) if (name.includes("/logs/")) delete files[name];
    const ev = await evidenceFor(files);
    expect(ev.console).toEqual([]);
    expect(ev.network).toEqual([]);
  });

  it("does not read logs that belong to another test", async () => {
    const files = failingPack({
      "tests/t-2/test.md": "# Other\n",
      "tests/t-2/logs/0-console.ndjson": consoleLog([{ level: "error", text: "other test's error", step: "2" }]),
    });
    expect((await evidenceFor(files)).console.map((c) => c.text)).not.toContain("other test's error");
  });
});
