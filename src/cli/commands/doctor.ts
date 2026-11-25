import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { kaneStatus } from "../../kane/doctor.js";
import { runCommand } from "../../shared/proc.js";
import { out } from "../../shared/logger.js";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

async function chromeFound(): Promise<boolean> {
  const override = process.env.KANE_CLI_CHROME_PATH;
  for (const path of override ? [override] : CHROME_PATHS) {
    try {
      if (!(await stat(path)).isFile()) continue;
      await access(path, constants.X_OK);
      return true;
    } catch {
      // Not at this location; try the next standard path.
    }
  }
  return false;
}

async function ghReady(): Promise<"ready" | "signed-out" | "missing"> {
  const result = await runCommand("gh", ["auth", "status"], { cwd: process.cwd(), timeoutMs: 15_000, killGraceMs: 2_000 });
  if (result.spawnError) return "missing";
  return result.exitCode === 0 ? "ready" : "signed-out";
}

/** `kane-judge doctor`: is everything Kane Judge needs in place? */
export async function doctorCommand(): Promise<number> {
  const [kane, chrome, gh] = await Promise.all([kaneStatus("kane-cli", process.cwd()), chromeFound(), ghReady()]);
  const kaneLine = !kane.installed
    ? "✗ Kane CLI not installed: npm install -g @testmuai/kane-cli"
    : kane.loggedIn === false
      ? `✗ Kane CLI ${kane.version ?? ""} is not signed in: run \`kane-cli login --oauth\` in a terminal`
      : kane.loggedIn ? `✓ Kane CLI ${kane.version ?? ""}, signed in` : "✗ Could not verify Kane sign-in. Check kane-cli whoami and retry.";
  const lines = [
    kaneLine,
    chrome ? "✓ Google Chrome found" : "✗ Google Chrome not found (Kane drives a real Chrome); or set KANE_CLI_CHROME_PATH",
    gh === "ready" ? "✓ GitHub CLI signed in (repo scans use your 5,000 calls/hour)" : `• GitHub CLI ${gh}: repo scans fall back to the public API (60 calls/hour)`,
  ];
  out(lines.join("\n"));
  return kane.installed && kane.loggedIn === true && chrome ? 0 : 2;
}
