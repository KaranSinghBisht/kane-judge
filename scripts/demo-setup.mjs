// Creates a fresh copy of the Inkwell demo shop as its own git repository,
// ready for a Kane Gate demo:  npm run demo:setup -- [target-dir] [--force]
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "examples", "shop");
const SKIP = /(^|\/)(node_modules|\.kane-gate|\.testmuai|\.omc|output-[^/]*|helper-output-[^/]*)(\/|$)/;

function parseArgs(argv) {
  const force = argv.includes("--force");
  const positional = argv.filter((a) => !a.startsWith("--"));
  return { target: resolve(positional[0] ?? join(homedir(), "inkwell-shop")), force };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function hasGitIdentity(cwd) {
  const name = spawnSync("git", ["config", "user.name"], { cwd, encoding: "utf8" }).stdout.trim();
  const email = spawnSync("git", ["config", "user.email"], { cwd, encoding: "utf8" }).stdout.trim();
  return Boolean(name && email);
}

async function prepareTarget(target, force) {
  let entries = [];
  try {
    entries = await readdir(target);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (entries.length > 0 && !force) {
    throw new Error(`${target} already exists and is not empty (pass --force to replace it)`);
  }
  if (entries.length > 0) await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function main() {
  const { target, force } = parseArgs(process.argv.slice(2));
  if (target === source || target.startsWith(`${repoRoot}/`)) throw new Error("pick a target outside the kane-gate repository");
  await prepareTarget(target, force);
  await cp(source, target, { recursive: true, filter: (src) => !SKIP.test(src.slice(source.length)) });
  git(target, ["init", "-q", "-b", "main"]);
  git(target, ["add", "-A"]);
  const identity = hasGitIdentity(target) ? [] : ["-c", "user.name=Kane Gate demo", "-c", "user.email=demo@example.invalid"];
  git(target, [...identity, "commit", "-q", "-m", "Inkwell shop: storefront, checkout and Kane flows"]);
  process.stdout.write(
    [
      `Demo shop ready at ${target}`,
      "",
      "Next:",
      `  cd ${target}`,
      `  claude --plugin-dir ${repoRoot}        # loads Kane Gate from this checkout`,
      "",
      "Then ask Claude, for example:",
      '  "Add a promo code field to checkout. The payments API already accepts SAVE10 (10% off the subtotal)."',
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`demo-setup: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
