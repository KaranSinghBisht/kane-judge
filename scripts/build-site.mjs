// Builds the hosted page in docs/: the playground bundle (the report's own
// checks, compiled for the browser) and index.html with the committed run's
// verdict, results and scan embedded.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

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
const page = template
  .replace("{{VERDICT}}", () => embed(verdict))
  .replace("{{RESULTS}}", () => embed(results))
  .replace("{{SCAN}}", () => embed(scan));
await writeFile("docs/index.html", page, "utf8");
for (const [from, to] of [[`${EXAMPLE}/scorecard.html`, "docs/sample-scorecard.html"], [`${EXAMPLE}/report.md`, "docs/sample-report.md"], [`${PREFLIGHT}/scorecard.html`, "docs/sample-preflight-scorecard.html"], [`${PREFLIGHT}/report.md`, "docs/sample-preflight-report.md"]]) {
  await writeFile(to, await readFile(from));
}
process.stdout.write("built docs/index.html and docs/playground.js\n");
