/** Fetches a submission page as text plus its links. Page content is untrusted data. */
export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  title?: string;
  /** Visible text, scripts and styles removed. */
  text: string;
  /** The raw HTML (bounded), kept for prompt-injection checks on hidden content. */
  html: string;
  links: string[];
}

const MAX_BYTES = 3 * 1024 * 1024;
export const USER_AGENT = "kane-judge/0.1 (+https://github.com/KaranSinghBisht/kane-judge)";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) return safeCodePoint(parseInt(lower.slice(2), 16)) ?? whole;
    if (lower.startsWith("#")) return safeCodePoint(parseInt(lower.slice(1), 10)) ?? whole;
    return ENTITIES[lower] ?? whole;
  });
}

function safeCodePoint(code: number): string | undefined {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

const SKIPPED_BLOCKS = ["script", "style", "noscript", "svg", "template"];

/** Index just past the `>` that closes the tag starting at `from`, or the end of the text. */
function afterTag(lower: string, from: number): number {
  const end = lower.indexOf(">", from);
  return end === -1 ? lower.length : end + 1;
}

function blockAt(lower: string, lt: number): string | undefined {
  return SKIPPED_BLOCKS.find((tag) => lower.startsWith(tag, lt + 1) && /[\s>/]/.test(lower[lt + 1 + tag.length] ?? ">"));
}

/**
 * Removes HTML comments and script/style/svg/template blocks in linear time.
 * (Lazy regexes rescan to the end for every unclosed opener: quadratic on hostile pages.)
 */
export function stripHidden(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = lower.indexOf("<", i);
    if (lt === -1) break;
    parts.push(html.slice(i, lt));
    if (lower.startsWith("<!--", lt)) {
      const close = lower.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
    } else {
      const tag = blockAt(lower, lt);
      const close = tag ? lower.indexOf(`</${tag}`, lt + 1) : -1;
      if (tag) i = close === -1 ? html.length : afterTag(lower, close);
      else {
        parts.push("<");
        i = lt + 1;
        continue;
      }
    }
    parts.push(" ");
  }
  if (i < html.length) parts.push(html.slice(i));
  return parts.join("");
}

/** Visible text of an HTML document: no scripts, styles or tags; one block per line. */
export function htmlToText(html: string): string {
  const stripped = stripHidden(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|pre|blockquote|title)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function pageTitle(html: string): string | undefined {
  const lower = html.toLowerCase();
  const open = lower.indexOf("<title");
  if (open === -1) return undefined;
  const start = afterTag(lower, open);
  const close = lower.indexOf("</title", start);
  if (close === -1) return undefined;
  const title = decodeEntities(html.slice(start, Math.min(close, start + 500))).replace(/\s+/g, " ").trim();
  return title || undefined;
}

/** Absolute http(s) links found in href attributes, de-duplicated, in page order. */
export function extractLinks(html: string, base: string): string[] {
  const seen = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1] ?? ""), base);
      if (url.protocol === "http:" || url.protocol === "https:") seen.add(url.toString());
    } catch {
      // Malformed hrefs are common in scraped pages; they carry no usable link.
    }
  }
  return [...seen];
}

async function readBounded(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchedPage> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  const html = await readBounded(res);
  const finalUrl = res.url || url;
  return { url, finalUrl, status: res.status, title: pageTitle(html), text: htmlToText(html), html, links: extractLinks(html, finalUrl) };
}

const CHALLENGE_TITLE = /^(just a moment|attention required|access denied|checking your browser|please wait|security check)/i;
const CHALLENGE_MARKERS = ["challenges.cloudflare.com", "cf-chl-", "__cf_chl", "Enable JavaScript and cookies to continue", "cf-browser-verification"];

/** True when a bot-protection interstitial (e.g. Cloudflare's "Just a moment...") came back instead of the page. */
export function isBotChallenge(page: Pick<FetchedPage, "title" | "html" | "status">): boolean {
  if (page.title && CHALLENGE_TITLE.test(page.title)) return true;
  return (page.status === 403 || page.status === 503 || page.status === 429) && CHALLENGE_MARKERS.some((m) => page.html.includes(m));
}

/**
 * True for loopback, private, link-local and cloud-metadata hosts. Links found in a
 * submission are never probed when they point there (a submission must not be able
 * to make the judge's machine reach its own network); an explicit --live is trusted.
 */
export function isPrivateHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  // IPv6 literals only (they contain a colon): fdroid.org and fcc.gov are ordinary public names.
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || host.startsWith("fe80") || host.startsWith("::ffff:");
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return false;
  const [a = 0, b = 0] = octets;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** HTTP status of a URL (0 when it can't be reached). Redirects are not followed: a 3xx still means "up". */
export async function probeStatus(url: string, timeoutMs = 15_000): Promise<number> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": USER_AGENT } });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}
