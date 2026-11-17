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

/** Visible text of an HTML document: no scripts, styles or tags; one block per line. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
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
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
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

/** HTTP status of a URL (0 when it can't be reached). Used to check that a live demo is up. */
export async function probeStatus(url: string, timeoutMs = 15_000): Promise<number> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": USER_AGENT } });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}
