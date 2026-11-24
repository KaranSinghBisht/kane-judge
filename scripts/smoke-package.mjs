// Exercise the exact npm artifact in a clean folder, without dev dependencies,
// a Kane account, or network access to install anything.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "kane-package-"));
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir]));
  const pack = packed[0];
  const prefix = join(dir, "install");
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", prefix, join(dir, pack.filename)]);
  const cli = join(prefix, "node_modules/.bin/kane-judge");
  // An absolute Node path still works when Kane and all other user binaries
  // are absent from PATH. The demo must verify its bundled evidence unaided.
  const options = { cwd: dir, env: { ...process.env, PATH: "/usr/bin:/bin", TMPDIR: dir } };
  const version = run(process.execPath, [cli, "--version"], options).trim();
  // Exercise npm's installed command as the user would invoke it.
  const installed = run(cli, ["--version"], { cwd: dir, env: { ...process.env, PATH: dirname(process.execPath) } }).trim();
  if (installed !== version) throw new Error("The installed command and bundled CLI disagree on their version");
  const expected = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (version !== expected) throw new Error(`Bundled CLI version ${version} differs from package ${expected}`);
  const output = run(process.execPath, [cli, "demo", "--no-open"], options);
  if (!output.includes("8 of 8 refused") || !output.includes("evidence pack(s) re-read")) throw new Error("The packed demo did not verify its evidence and refuse every cheat.");
  console.log(`Packed install smoke passed: v${version}, ${pack.files.length} files, ${(pack.size / 1024 / 1024).toFixed(1)} MB compressed, no dev dependencies or Kane account.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
