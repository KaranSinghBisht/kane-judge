import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { parse as parseYaml } from "yaml";

/**
 * A copy of a sealed evidence pack that is safe to commit or send. Kane writes
 * the signed-in account and the machine's paths into a few log files and into
 * each test's result.yaml; everything else (steps, screenshots, statuses,
 * failure records) is copied as Kane sealed it. The files stay in place,
 * emptied, because Kane's own validator checks that they exist.
 */
export interface SharedPack {
  bytes: Uint8Array;
  /** Files emptied because they hold the account, local paths or raw runner output. */
  blanked: number;
  /** Text files in which an identity value or secret header was replaced. */
  scrubbed: number;
  /** The account values found in the sealed pack. Kept in memory only, to scrub what is copied beside the pack. */
  identity: string[];
}

const PLACEHOLDER = "Removed by `kane-judge share`: this file can hold the Kane account and local paths.\n";
const EMPTY_HAR = '{"log":{"version":"1.2","creator":{"name":"kane-judge share","version":"1"},"entries":[]}}\n';
const BLANKED = [/\/logs\/tui\.log$/, /\/logs\/\d+-run\.log$/, /\/logs\/runner-stderr\.log$/, /\/auteur\//];
const TEXT = /\.(?:ya?ml|json|ndjson|md|log|har|txt)$/i;
const IDENTITY_LINE = /^(\s*(?:org_id|user_name|user_email|user_id|project_id|folder_id)\s*:\s*).*$/gim;
const IDENTITY_FIELDS = ["user_email", "user_name", "org_id", "user_id"];
const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization", "x-api-key", "x-auth-token"]);
const SECRET_QUERY = /(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|signature|credential|session|code)/i;
const REMOVED = "[removed]";
/** A fixed time for every entry, so the same sealed pack always gives the same share copy. */
const ENTRY_TIME = new Date("2026-01-01T00:00:00Z");
/** Values shorter than this would match by accident ("1", "me"). */
const MIN_SECRET = 4;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The account values Kane wrote into the pack's result.yaml files. */
function identityValues(files: Record<string, Uint8Array>): string[] {
  const found = new Set<string>();
  for (const [name, bytes] of Object.entries(files)) {
    if (!/^tests\/[^/]+\/result\.yaml$/.test(name)) continue;
    let doc: unknown;
    try {
      doc = parseYaml(strFromU8(bytes));
    } catch {
      continue;
    }
    const ids = isObject(doc) && isObject(doc.external_id) ? doc.external_id : {};
    for (const field of IDENTITY_FIELDS) {
      const value = ids[field];
      if ((typeof value === "string" || typeof value === "number") && value !== "redacted" && value !== REMOVED) found.add(String(value));
    }
  }
  return [...found];
}

function scrubHeaders(list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const header of list) {
    if (isObject(header) && typeof header.name === "string" && SECRET_HEADERS.has(header.name.toLowerCase())) header.value = REMOVED;
  }
}

/** A HAR without cookies, credentials or request bodies. What was requested and how it was answered stays. */
function scrubHar(text: string): string {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return EMPTY_HAR;
  }
  const entries = isObject(doc) && isObject(doc.log) && Array.isArray(doc.log.entries) ? doc.log.entries : [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    for (const side of [entry.request, entry.response]) {
      if (!isObject(side)) continue;
      scrubHeaders(side.headers);
      if (typeof side.url === "string") {
        try {
          const url = new URL(side.url);
          url.username = "";
          url.password = "";
          for (const key of [...url.searchParams.keys()]) if (SECRET_QUERY.test(key)) url.searchParams.set(key, REMOVED);
          side.url = url.toString();
        } catch {
          side.url = REMOVED;
        }
      }
      if (Array.isArray(side.queryString)) {
        for (const param of side.queryString) if (isObject(param) && typeof param.name === "string" && SECRET_QUERY.test(param.name)) param.value = REMOVED;
      }
      if (Array.isArray(side.cookies)) side.cookies = [];
      if (isObject(side.postData)) side.postData = { mimeType: side.postData.mimeType, text: REMOVED };
      if (isObject(side.content) && side.content.text !== undefined) side.content.text = REMOVED;
      if (typeof side.redirectURL === "string" && side.redirectURL) side.redirectURL = REMOVED;
    }
  }
  return JSON.stringify(doc);
}

/** Replaces every secret in `text`, longest first, so a path is replaced before the user name inside it. */
export function scrubText(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of [...new Set(secrets)].filter((s) => s.length >= MIN_SECRET).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("redacted");
  }
  return out;
}

function shareEntry(name: string, bytes: Uint8Array, secrets: string[]): { bytes: Uint8Array; change: "blanked" | "scrubbed" | "kept" } {
  if (BLANKED.some((pattern) => pattern.test(`/${name}`))) return { bytes: strToU8(PLACEHOLDER), change: "blanked" };
  if (!TEXT.test(name)) return { bytes, change: "kept" };
  const before = strFromU8(bytes);
  let after = /\.har$/i.test(name) ? scrubHar(before) : before;
  if (/\/result\.yaml$/.test(name)) after = after.replace(IDENTITY_LINE, "$1redacted");
  after = scrubText(after, secrets);
  return after === before ? { bytes, change: "kept" } : { bytes: strToU8(after), change: "scrubbed" };
}

/** Builds the share copy of a sealed pack. `extraSecrets` are values to remove besides Kane's account (home folder, user name). */
export function sharePack(sealed: Uint8Array, extraSecrets: string[] = []): SharedPack {
  const files = unzipSync(sealed);
  const identity = identityValues(files);
  const secrets = [...identity, ...extraSecrets];
  const entries: Zippable = {};
  let blanked = 0;
  let scrubbed = 0;
  for (const name of Object.keys(files).sort()) {
    const original = files[name];
    if (!original || name.endsWith("/")) continue;
    const shared = shareEntry(name, original, secrets);
    if (shared.change === "blanked") blanked += 1;
    if (shared.change === "scrubbed") scrubbed += 1;
    // Screenshots are already compressed; storing them keeps the copy quick to build.
    entries[name] = [shared.bytes, { level: TEXT.test(name) ? 6 : 0, mtime: ENTRY_TIME }];
  }
  return { bytes: zipSync(entries), blanked, scrubbed, identity };
}

/** The text entries of a pack that still contain one of `secrets`: empty for a pack that is safe to share. */
export function leaksIn(pack: Uint8Array, secrets: string[]): string[] {
  const wanted = [...new Set(secrets)].filter((s) => s.length >= MIN_SECRET);
  const files = unzipSync(pack, { filter: (file) => TEXT.test(file.name) });
  return Object.entries(files)
    .filter(([, bytes]) => {
      const text = strFromU8(bytes);
      return wanted.some((secret) => text.includes(secret));
    })
    .map(([name]) => name);
}
