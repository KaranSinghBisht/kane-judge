// Builds the hosted page in docs/: the playground bundle (the report's own
// checks, compiled for the browser) and index.html with the committed run's
// verdict, results and scan embedded.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const EXAMPLE = "examples/judged/inkwell-shop";
const PREFLIGHT = "examples/preflight/inkwell-shop";

// Keep the published scorecards on the current checker and renderer, rather
// than copying an old screenshot/report that happened to be committed.
for (const project of [EXAMPLE, PREFLIGHT, "examples/negative/deployed-promo"]) {
  execFileSync(process.execPath, ["dist/kane-judge.mjs", "report", project], { stdio: "inherit" });
}

// The checks never touch the file system; these stand in for the Node modules their neighbours import.
const SHIMS = {
  "node:crypto": `export function createHash() { let h = 2166136261; const api = { update(t) { for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return api; }, digest() { return h.toString(16).padStart(8, "0").repeat(2); } }; return api; }`,
  "node:fs/promises": `export async function readFile() { throw new Error("no files in the browser"); } export async function stat() { throw new Error("no files in the browser"); }`,
  "node:path": `export function extname(p) { const m = /\\.[^./]+$/.exec(String(p)); return m ? m[0] : ""; }`,
};

const nodeShims = {
  name: "node-shims",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => (args.path in SHIMS ? { path: args.path, namespace: "shim" } : { errors: [{ text: `no browser shim for ${args.path}` }] }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({ contents: SHIMS[args.path], loader: "js" }));
  },
};

await build({
  entryPoints: ["src/site/playground.ts"],
  outfile: "docs/playground.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "KaneJudge",
  target: "es2020",
  minify: true,
  plugins: [nodeShims],
});

/** JSON that is safe inside a <script> element. */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const embed = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
const json = async (name) => JSON.parse(await readFile(`${EXAMPLE}/${name}`, "utf8"));

const results = await json("kane-results.json");
// The replay frames are images on disk; the playground renders the scorecard without them.
for (const flow of Object.values(results.flows)) {
  delete flow.frames;
  for (const run of flow.history ?? []) delete run.frames;
}
const verdict = await readFile(`${EXAMPLE}/verdict.json`, "utf8");
const template = await readFile("site/index.template.html", "utf8");
const scan = await json("scan.json");
// Function replacements: the JSON holds "$" amounts, which a replacement string would read as patterns.
const css = await readFile("site/site.css", "utf8");
const page = template
  .replace("{{SITE_CSS}}", () => css)
  .replace("{{VERDICT}}", () => embed(verdict))
  .replace("{{RESULTS}}", () => embed(results))
  .replace("{{SCAN}}", () => embed(scan));
const offlineProof = '<a class="btn primary" href="sample-preflight-scorecard.html#claim-c4">Watch the failed and repaired checkout</a>';
await writeFile("docs/index.html", page.replace("<!-- HOSTED_CONTROLS -->", offlineProof), "utf8");
for (const [from, to] of [[`${EXAMPLE}/scorecard.html`, "docs/sample-scorecard.html"], [`${EXAMPLE}/report.md`, "docs/sample-report.md"], [`${PREFLIGHT}/scorecard.html`, "docs/sample-preflight-scorecard.html"], [`${PREFLIGHT}/report.md`, "docs/sample-preflight-report.md"]]) {
  await writeFile(to, await readFile(from));
}
process.stdout.write("built docs/index.html and docs/playground.js\n");

// Publish a curated static directory. Raw workspaces, account data and audit notes stay out.
const output = "public-demo";
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "proof"), { recursive: true });
for (const name of ["playground.js", "checkout-before.png", "checkout-after.png", "sample-scorecard.html", "sample-preflight-scorecard.html"]) {
  await copyFile(join("docs", name), join(output, name));
}
await cp("docs/fonts", join(output, "fonts"), { recursive: true });
await cp("docs/replay", join(output, "replay"), { recursive: true });
const negative = "examples/negative/deployed-promo";
const controls = [];
for (const [label, project, status] of [["deployed", negative, "failed"], ["repaired", PREFLIGHT, "passed"]]) {
  const records = JSON.parse(await readFile(join(project, "kane-results.json"), "utf8"));
  const run = records.runs.at(-1);
  const bytes = await readFile(join(project, run.evidencePath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== run.sharedPackSha256 || run.outcome !== status || run.heal !== false) {
    throw new Error(`Expected the scrubbed, healing-off ${label} control`);
  }
  const file = `proof/${label}-${sha256.slice(0, 12)}.evidence`;
  await writeFile(join(output, file), bytes);
  controls.push({ label, file, sha256, status });
}
await copyFile(join(negative, "scorecard.html"), join(output, "deployed-promo-scorecard.html"));
// A real hackathon entry judged on 25 Nov 2026: its checked scorecard and Kane's screenshot of the claim the judge refused.
for (const name of ["real-scorecard.html", "real-overruled.jpg"]) await copyFile(join("docs", name), join(output, name));
await copyFile(join(PREFLIGHT, "flows/04-apply-promo_test.md"), join(output, "proof/checkout-test.txt"));
await copyFile(join(PREFLIGHT, "checkout-repair.patch"), join(output, "proof/checkout-repair.txt"));
await build({ entryPoints: ["site/check-controls.js"], outfile: join(output, "check-controls.js"), bundle: true, platform: "browser", minify: true });
const controlsHtml = (await readFile("site/controls.html", "utf8")).replace("{{CONTROLS}}", () => embed(controls));
await writeFile(join(output, "index.html"), page.replace("<!-- HOSTED_CONTROLS -->", () => controlsHtml));
