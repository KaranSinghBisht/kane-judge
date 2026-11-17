import { runCommand } from "../shared/proc.js";

export interface KaneStatus {
  installed: boolean;
  version?: string;
  /** undefined when it could not be determined. */
  loggedIn?: boolean;
}

/** Checks that kane-cli is installed and signed in (`kane-cli whoami` exits 0 only when signed in). */
export async function kaneStatus(kaneBin: string, cwd: string): Promise<KaneStatus> {
  const version = await runCommand(kaneBin, ["--version"], { cwd, timeoutMs: 20_000, killGraceMs: 2_000 });
  if (version.spawnError || version.exitCode !== 0) return { installed: false };
  const who = await runCommand(kaneBin, ["whoami"], { cwd, timeoutMs: 30_000, killGraceMs: 2_000 });
  const loggedIn = who.timedOut || who.spawnError ? undefined : who.exitCode === 0;
  return { installed: true, version: version.stdout.trim().split(/\s+/).pop(), loggedIn };
}
