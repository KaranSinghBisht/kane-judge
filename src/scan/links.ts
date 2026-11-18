/** Sorts a submission's links into repos, demo videos and likely live demos. */
export interface RepoRef {
  owner: string;
  repo: string;
  url: string;
  /** Branch or tag, from a /tree/<ref>/… or /blob/<ref>/… URL. */
  ref?: string;
  /** Folder inside the repo, when the submission lives in a subfolder (monorepos, example apps). */
  path?: string;
}

export interface LinkSets {
  repos: RepoRef[];
  videos: string[];
  /** Links that look like a deployed app, best guesses first. */
  demos: string[];
}

const GITHUB_RESERVED = new Set([
  "about", "apps", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features",
  "login", "marketplace", "new", "notifications", "orgs", "pricing", "pulls", "issues", "security", "settings",
  "site", "sponsors", "topics", "trending", "join", "readme", "solutions", "resources", "team",
]);

/** Hosts that are never the demo itself: social, code hosting, video, hackathon platforms. */
const NOT_DEMO = [
  "github.com", "githubusercontent.com", "gitlab.com", "bitbucket.org", "devpost.com", "ethglobal.com",
  "devfolio.co", "dorahacks.io", "youtube.com", "youtu.be", "loom.com", "vimeo.com", "twitter.com", "x.com",
  "linkedin.com", "facebook.com", "instagram.com", "discord.gg", "discord.com", "t.me", "medium.com",
  "substack.com", "reddit.com", "news.ycombinator.com", "google.com", "docs.google.com", "drive.google.com",
  "figma.com", "notion.so", "canva.com", "slides.com", "npmjs.com", "pypi.org", "producthunt.com",
  "challengepost-s3-challengepost.netdna-ssl.com", "d112y698adiu2z.cloudfront.net", "kaneclihack.sh",
  "slack.com", "lu.ma", "luma.com", "eventbrite.com", "calendly.com", "typeform.com", "forms.gle", "testmuai.com",
  "lambdatest.com", "apple.com", "anthropic.com", "openai.com", "vercel.com", "netlify.com", "wikipedia.org",
  "shields.io", "badgen.net", "badge.fury.io", "imgur.com", "nodejs.org", "npmjs.org", "claude.ai", "claude.com",
];

/** Hosts where hackathon demos are usually deployed; ranked first. */
const DEMO_HOSTS = [
  "vercel.app", "netlify.app", "pages.dev", "github.io", "onrender.com", "railway.app", "fly.dev", "herokuapp.com",
  "web.app", "firebaseapp.com", "surge.sh", "replit.app", "repl.co", "streamlit.app", "glitch.me", "deno.dev",
  "workers.dev", "amplifyapp.com", "azurewebsites.net", "up.railway.app", "hf.space", "lovable.app", "bolt.new",
];

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

function decodeSegment(segment: string): string | undefined {
  try {
    const text = decodeURIComponent(segment);
    return text === "" || text === "." || text === ".." || /[\\/\u0000-\u001f]/.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * The branch and folder of a /tree/<ref>/<folder> URL (or the folder holding a
 * /blob/<ref>/<file>). Branch names that contain a slash are not supported.
 */
function subfolder(parts: string[]): Pick<RepoRef, "ref" | "path"> {
  const [kind, ref, ...rest] = parts;
  if ((kind !== "tree" && kind !== "blob") || !ref || !SAFE_NAME.test(ref)) return {};
  const segments = (kind === "blob" ? rest.slice(0, -1) : rest).map(decodeSegment);
  if (segments.some((s) => s === undefined)) return { ref };
  return { ref, path: segments.length ? segments.join("/") : undefined };
}

export function parseRepo(url: string): RepoRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return undefined;
  const [owner, rawRepo, ...rest] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo || GITHUB_RESERVED.has(owner.toLowerCase())) return undefined;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(repo)) return undefined;
  const root = `https://github.com/${owner}/${repo}`;
  const { ref, path } = subfolder(rest);
  if (!ref || !path) return { owner, repo, url: root, ...(ref ? { ref } : {}) };
  return { owner, repo, url: `${root}/tree/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`, ref, path };
}

function isVideo(host: string, path: string): boolean {
  if (hostMatches(host, "youtu.be") || hostMatches(host, "vimeo.com")) return true;
  if (hostMatches(host, "youtube.com")) return path.startsWith("/watch") || path.startsWith("/shorts") || path.startsWith("/embed");
  return hostMatches(host, "loom.com") && path.startsWith("/share");
}

function demoRank(host: string): number {
  return DEMO_HOSTS.some((d) => hostMatches(host, d)) ? 0 : 1;
}

/** True when the URL sits on a host hackathon demos are usually deployed to (vercel.app, netlify.app, …). */
export function isDemoHost(url: string): boolean {
  const host = safeHost(url);
  return !!host && demoRank(host) === 0;
}

/** Classifies links; `pageUrl`'s own host is excluded from demo candidates. */
export function classifyLinks(links: string[], pageUrl?: string): LinkSets {
  const pageHost = pageUrl ? safeHost(pageUrl) : undefined;
  const repos = new Map<string, RepoRef>();
  const videos: string[] = [];
  const demos: Array<{ url: string; rank: number }> = [];
  for (const link of links) {
    const host = safeHost(link);
    if (!host) continue;
    const repo = parseRepo(link);
    if (repo) {
      repos.set(`${repo.owner}/${repo.repo}`.toLowerCase(), repo);
      continue;
    }
    const path = new URL(link).pathname;
    if (isVideo(host, path)) videos.push(link);
    else if (host !== pageHost && !NOT_DEMO.some((d) => hostMatches(host, d))) demos.push({ url: link, rank: demoRank(host) });
  }
  const sortedDemos = demos.sort((a, b) => a.rank - b.rank).map((d) => d.url);
  return { repos: [...repos.values()], videos: [...new Set(videos)], demos: [...new Set(sortedDemos)] };
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}
