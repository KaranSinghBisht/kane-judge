import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { toPosix } from "../shared/fs.js";

export interface Flow {
  /** Path inside flowsDir without the `_test.md` suffix, e.g. "checkout" or "admin/users". */
  name: string;
  /** Project-relative posix path of the flow file. */
  file: string;
  /** First `# ` heading, when present. */
  title?: string;
  /** Root `url:` frontmatter, when present. */
  url?: string;
  tags: string[];
}

const FLOW_SUFFIX = "_test.md";
const SKIP_DIR = /^(output-|helper-output-|node_modules$|\.)/;

async function listFlowFiles(absDir: string, relDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) found.push(...(await listFlowFiles(join(absDir, entry.name), rel)));
    } else if (entry.isFile() && entry.name.endsWith(FLOW_SUFFIX)) {
      found.push(rel);
    }
  }
  return found;
}

interface FlowHeader {
  title?: string;
  url?: string;
  tags: string[];
}

/** Reads the frontmatter and title of a `_test.md` file. Malformed frontmatter is tolerated (Kane reports it). */
export function parseFlowHeader(raw: string): FlowHeader {
  const header: FlowHeader = { tags: [] };
  // A byte-order mark in front of the first `---` would hide the frontmatter.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    try {
      const data = parseYaml(fm[1] ?? "") as Record<string, unknown> | null;
      if (data && typeof data.url === "string") header.url = data.url;
      if (Array.isArray(data?.tags)) header.tags = data.tags.filter((t): t is string => typeof t === "string");
      else if (typeof data?.tags === "string") header.tags = data.tags.split(",").map((t) => t.trim()).filter(Boolean);
    } catch {
      // Kane itself rejects invalid frontmatter with a clear parse error (exit 2); nothing to add here.
    }
  }
  const title = /^#\s+(.+)$/m.exec(body.split(/^##\s/m)[0] ?? "");
  if (title?.[1]) header.title = title[1].trim();
  return header;
}

/** Discovers every `*_test.md` flow under flowsDir (recursively, skipping Kane output dirs). */
export async function discoverFlows(projectDir: string, flowsDir: string): Promise<Flow[]> {
  const absDir = join(projectDir, flowsDir);
  const files = (await listFlowFiles(absDir, "")).sort();
  const flows: Flow[] = [];
  for (const rel of files) {
    const text = await readFile(join(absDir, rel), "utf8");
    const header = parseFlowHeader(text);
    flows.push({
      name: rel.slice(0, -FLOW_SUFFIX.length),
      file: toPosix(join(flowsDir, rel)),
      ...header,
    });
  }
  return flows;
}

/** Steps (`## ` headings) of a flow, in order. Used to name the failing step in reports. */
export function flowStepHeadings(text: string): string[] {
  return [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim());
}
