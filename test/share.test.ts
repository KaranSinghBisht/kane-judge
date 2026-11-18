import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { shareCommand } from "../src/cli/commands/share.js";
import { leaksIn, scrubText, sharePack } from "../src/evidence/share-pack.js";
import { verifyPacks } from "../src/judge/pack-verify.js";
import { emptyResults, mergeRun, type FlowResult, type KaneResults } from "../src/judge/results.js";
import type { Verdict } from "../src/judge/verdict.js";
import { configureLogger } from "../src/shared/logger.js";
import { buildPack, SCREENSHOT } from "./helpers/pack.js";
import { must, useTempDirs, writeTree } from "./helpers/tmp.js";

const makeDir = useTempDirs();

beforeAll(() => {
  configureLogger({ stderr: false });
});

const EMAIL = "builder.person@example.org";
const ACCOUNT = "builderperson42";
const ORG = "9081726";
const TEST = "tests/01-promo-0a1b2c3d";

const RESULT_YAML = `evidence: '0.1'
test: 01-promo-0a1b2c3d
status: failed
external_id:
  execution_id: 11111111-2222-3333-4444-555555555555
  org_id: '${ORG}'
  user_name: ${ACCOUNT}
  user_email: ${EMAIL}
  sharable_link: https://test-manager.example/share/abc
steps:
  - { id: 0-1, ordinal: 1, status: passed, kind: navigate }
  - { id: 0-2, ordinal: 2, status: failed, kind: assert }
`;

const HAR = JSON.stringify({
  log: {
    version: "1.2",
    entries: [
      {
        request: { method: "POST", url: "https://shop.example.app/api/promo", headers: [{ name: "Cookie", value: "session=s3cr3t" }, { name: "Accept", value: "*/*" }], cookies: [{ name: "session", value: "s3cr3t" }], postData: { mimeType: "application/json", text: '{"card":"4242"}' } },
        response: { status: 500, headers: [{ name: "Set-Cookie", value: "session=n3w" }], cookies: [] },
      },
    ],
  },
});

function sealedPack(): Uint8Array {
  return buildPack({
    "run.yaml": "evidence: '0.1'\nstatus: finalized\n",
    [`${TEST}/result.yaml`]: RESULT_YAML,
    [`${TEST}/test.md`]: "# Promo\n\n## Apply\nApply SAVE10. Verify the Total is visibly shown.\n",
    [`${TEST}/steps/2-0-2/screenshot.png`]: SCREENSHOT,
    [`${TEST}/steps/2-0-2/step.json`]: JSON.stringify({ kind: "assert", status: "failed", summary: `assert: Total shown (run by ${ACCOUNT})` }),
    [`${TEST}/logs/tui.log`]: `signed in as ${EMAIL} at /Users/someone/project\n`,
    [`${TEST}/logs/0-run.log`]: `account ${ACCOUNT}\n`,
    [`${TEST}/logs/runner-stderr.log`]: "warn: something\n",
    [`${TEST}/logs/0-network.har`]: HAR,
    [`${TEST}/logs/0-console.ndjson`]: '{"level":"warning","text":"limit-rows removed 1 of 4 rows"}\n',
    [`${TEST}/auteur/execution.json`]: JSON.stringify({ user: EMAIL }),
  });
}

describe("a share copy of an evidence pack", () => {
  const shared = sharePack(sealedPack(), ["/Users/someone"]);
  const files = unzipSync(shared.bytes);
  const text = (name: string) => strFromU8(must(files[name], name));

  it("keeps every file Kane's validator expects, and empties the ones that hold the account", () => {
    expect(Object.keys(files).sort()).toEqual(Object.keys(unzipSync(sealedPack())).sort());
    for (const name of [`${TEST}/logs/tui.log`, `${TEST}/logs/0-run.log`, `${TEST}/logs/runner-stderr.log`, `${TEST}/auteur/execution.json`]) expect(text(name)).toContain("Removed by `kane-judge share`");
    expect(shared.blanked).toBe(4);
  });

  it("removes the account from result.yaml and from any other text, and leaves the evidence alone", () => {
    const result = text(`${TEST}/result.yaml`);
    expect(result).toContain("user_email: redacted");
    expect(result).toContain("user_name: redacted");
    expect(result).toContain("status: failed");
    expect(result).toContain("kind: assert");
    expect(result).toContain("sharable_link: https://test-manager.example/share/abc");
    expect(text(`${TEST}/steps/2-0-2/step.json`)).toContain("run by redacted");
    expect(files[`${TEST}/steps/2-0-2/screenshot.png`]).toEqual(SCREENSHOT);
    expect(text(`${TEST}/logs/0-console.ndjson`)).toContain("limit-rows removed 1 of 4 rows");
    expect(shared.identity.sort()).toEqual([ORG, ACCOUNT, EMAIL].sort());
  });

  it("drops cookies, credentials and request bodies from the network log, and keeps what was asked and answered", () => {
    const har = text(`${TEST}/logs/0-network.har`);
    expect(har).not.toContain("s3cr3t");
    expect(har).not.toContain("n3w");
    expect(har).not.toContain("4242");
    expect(har).toContain("https://shop.example.app/api/promo");
    expect(har).toContain('"status":500');
    expect(har).toContain('"value":"*/*"');
  });

  it("leaves nothing of the account behind, and gives the same bytes every time", () => {
    expect(leaksIn(shared.bytes, [EMAIL, ACCOUNT, ORG, "/Users/someone"])).toEqual([]);
    expect(leaksIn(sealedPack(), [EMAIL]).length).toBeGreaterThan(0);
    expect(sharePack(sealedPack(), ["/Users/someone"]).bytes).toEqual(shared.bytes);
  });

  it("replaces a longer secret before a shorter one inside it, and ignores values too short to be safe", () => {
    expect(scrubText("/Users/ana/shop by ana", ["ana", "/Users/ana"])).toBe("redacted/shop by ana");
    expect(scrubText("id 12 and 1234", ["12", "1234"])).toBe("id 12 and redacted");
  });
});

describe("kane-judge share", () => {
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const flow: FlowResult = {
    name: "01-promo",
    file: "flows/01-promo_test.md",
    status: "failed",
    attempts: 0,
    authored: true,
    steps: [{ index: 1, heading: "Apply", status: "failed" }],
    asserts: { total: 1, passed: 0 },
    claim: "c1",
    screenshot: "evidence/01-promo-run1-failed.png",
    lastRunAt: "2026-11-18T10:01:00Z",
    flowSha: "aaa",
  };
  const verdict: Verdict = {
    version: 1,
    project: { name: "Shop", slug: "shop", live: "https://shop.example.app" },
    summary: "The promo flow is broken.",
    claims: [{ id: "c1", claim: "Promo codes work", source: 'README: "Apply SAVE10 at checkout"', status: "broken", evidence: "Kane saw no Total.", flow: "flows/01-promo_test.md" }],
    scores: [{ criterion: "Works", score: 3, max: 10, why: "c1 broken" }],
    questions: [],
    flags: [],
  };

  async function project(packSha?: string): Promise<{ dir: string; results: KaneResults }> {
    const ws = await makeDir();
    const dir = join(ws, "projects", "shop");
    const pack = sealedPack();
    const results = mergeRun(emptyResults(), { at: flow.lastRunAt, flows: ["01-promo"], outcome: "failed", durationS: 40, evidencePath: ".testmuai/evidence/run-1.evidence", packSha256: packSha ?? sha(pack) }, [flow]);
    await writeTree(dir, {
      ".testmuai/evidence/run-1.evidence": pack,
      "evidence/01-promo-run1-failed.png": SCREENSHOT,
      "flows/01-promo_test.md": "---\nurl: https://shop.example.app/\ntags: [judge, c1]\n---\n# Promo\n\n## Apply\nApply SAVE10. Verify the Total is visibly shown.\n",
      "kane-results.json": JSON.stringify(results),
      "verdict.json": JSON.stringify(verdict),
      "scan.json": JSON.stringify({ version: 1, mode: "judge", scannedAt: "2026-11-18T10:00:00Z", slug: "shop", name: "Shop", inputs: ["https://github.com/team/shop"], demoCandidates: [], repos: [], videos: [], injectionHints: [], pages: [] }),
      "submission.md": `# Shop\n\nRead from ${dir}/README.md in ${homedir()}\n`,
    });
    return { dir, results };
  }

  async function allText(dir: string): Promise<string> {
    const names = await readdir(dir, { recursive: true, withFileTypes: true });
    const chunks: string[] = [];
    for (const entry of names.filter((e) => e.isFile() && /\.(json|md|html)$/.test(e.name))) chunks.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
    return chunks.join("\n");
  }

  it("writes a copy that passes the same checks, with the pack's account removed", async () => {
    const { dir } = await project();
    const outDir = `${dir}-share`;
    expect(await shareCommand({ dir })).toBe(0);
    const results = JSON.parse(await readFile(join(outDir, "kane-results.json"), "utf8")) as KaneResults;
    const run = must(results.runs[0]);
    expect(run.evidencePath).toBe("packs/run-1.evidence");
    expect(run.sharedPackSha256).toBe(sha(new Uint8Array(await readFile(join(outDir, "packs", "run-1.evidence")))));
    expect(run.packSha256).toBe(sha(sealedPack()));
    expect(await verifyPacks(outDir, results)).toEqual({ verified: 1, shared: 1, missing: 0, problems: [] });
    expect(leaksIn(new Uint8Array(await readFile(join(outDir, "packs", "run-1.evidence"))), [EMAIL, ACCOUNT, ORG])).toEqual([]);
    const text = await allText(outDir);
    for (const secret of [EMAIL, ACCOUNT, homedir(), dir]) expect(text).not.toContain(secret);
    expect(text).toContain("They are share copies: the Kane account and local paths were removed");
    expect(await readFile(join(outDir, "evidence", "01-promo-run1-failed.png"))).toEqual(Buffer.from(SCREENSHOT));
  });

  it("still catches a doctored results file in the copy", async () => {
    const { dir } = await project();
    const outDir = `${dir}-share`;
    await shareCommand({ dir });
    const results = JSON.parse(await readFile(join(outDir, "kane-results.json"), "utf8")) as KaneResults;
    const doctored = must(results.flows["01-promo"]);
    doctored.status = "passed";
    for (const entry of doctored.history ?? []) entry.status = "passed";
    expect((await verifyPacks(outDir, results)).problems.join()).toContain("Kane's sealed evidence pack says failed");
  });

  it("refuses to write into a folder that already has files, or to share a pack that isn't the one Kane sealed", async () => {
    const { dir } = await project();
    await writeTree(`${dir}-share`, { "notes.txt": "mine" });
    expect(await shareCommand({ dir })).toBe(2);
    const tampered = await project("0".repeat(64));
    expect(await shareCommand({ dir: tampered.dir })).toBe(2);
    expect(await readdir(`${tampered.dir}-share`).then((names) => names.includes("verdict.json"))).toBe(false);
  });

  it("needs Kane results to share", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "verdict.json"), "{}");
    expect(await shareCommand({ dir })).toBe(2);
  });
});
