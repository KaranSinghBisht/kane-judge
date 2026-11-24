import { mkdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { discoverFlows } from "../../flows/discover.js";
import { isScanResult } from "../../scan/types.js";
import { readJsonFile } from "../../shared/fs.js";
import { safeMessage } from "../../shared/errors.js";
import { out } from "../../shared/logger.js";
import { projectPaths } from "../../judge/workspace.js";

/** Where a withdrawn claim's flow is kept: out of `flows/`, so no run picks it up, but still on record. */
export const WITHDRAWN_DIR = "withdrawn";

/**
 * `kane-judge withdraw <project> <flow>`: pre-flight only. When the builder takes
 * a claim out of the README, its flow moves out of `flows/` so the final gate
 * no longer runs it. Kane's earlier results for it stay in kane-results.json.
 */
export async function withdrawCommand(dir: string | undefined, flowName: string | undefined): Promise<number> {
  if (!dir || !flowName) {
    out("usage: kane-judge withdraw <project-dir> <flow>");
    return 2;
  }
  const paths = projectPaths(dir);
  const scan = await readJsonFile(paths.scan).catch(() => undefined);
  if (!isScanResult(scan) || scan.mode !== "preflight") {
    out("Only the builder's pre-flight may withdraw a flow. Scan your own project with --preflight first; a judge keeps failed claims on record.");
    return 2;
  }
  const wanted = flowName.replace(/_test\.md$/, "").replace(/^flows\//, "");
  const flow = (await discoverFlows(paths.dir, "flows")).find((f) => f.name === wanted);
  if (!flow) {
    out(`No flow named ${wanted} in ${paths.flowsDir}.`);
    return 2;
  }
  const dest = join(paths.dir, WITHDRAWN_DIR, basename(flow.file));
  try {
    await mkdir(join(paths.dir, WITHDRAWN_DIR), { recursive: true });
    await rename(join(paths.dir, flow.file), dest);
  } catch (err) {
    out(`kane-judge withdraw: could not move ${flow.file}: ${safeMessage(err)}`);
    return 2;
  }
  out(`Withdrew ${flow.name}: moved to ${WITHDRAWN_DIR}/${basename(flow.file)}. Runs no longer include it. In verdict.json, give the claim "status": "withdrawn" and a "fix" that says what the README no longer promises; keep its "flow" path as it was.`);
  return 0;
}
