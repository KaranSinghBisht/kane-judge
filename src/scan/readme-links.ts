import { classifyLinks, isDemoHost } from "./links.js";

/** Plain http(s) URLs; linear, with no nested repetition. */
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/g;
/** Words that mark the link on a README line as the deployed app. */
const DEMO_WORDS = /\b(?:live|demo|try it|deployed|deployment|hosted|production|website|web app|play it|open the app)\b/i;
const ASSET = /\.(?:png|jpe?g|gif|svg|webp|ico|mp4|webm|mov|pdf|zip)(?:[?#].*)?$/i;
const MAX_LINE = 2_000;
const MAX_LINKS = 200;

interface Candidate {
  url: string;
  /** The link's own README line says it is the demo ("Live demo: …"). */
  named: boolean;
}

function candidates(readme: string): Candidate[] {
  const found: Candidate[] = [];
  for (const raw of readme.split(/\r?\n/)) {
    if (found.length >= MAX_LINKS) break;
    const line = raw.slice(0, MAX_LINE);
    const named = DEMO_WORDS.test(line);
    for (const match of line.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:!?*_]+$/, "");
      if (!ASSET.test(url)) found.push({ url, named });
    }
  }
  return found;
}

/**
 * Links in a README that are probably the deployed demo, best guess first. A
 * link counts only when its line calls it the demo ("Live demo: …") or it sits
 * on a host demos are usually deployed to; everything else in a README is docs.
 */
export function readmeDemoLinks(readme: string): string[] {
  const all = candidates(readme);
  const named = new Set(all.filter((c) => c.named).map((c) => c.url));
  const demos = classifyLinks(all.map((c) => c.url)).demos.filter((url) => named.has(url) || isDemoHost(url));
  const rank = (url: string) => (named.has(url) ? 0 : 2) + (isDemoHost(url) ? 0 : 1);
  return demos.sort((a, b) => rank(a) - rank(b));
}
