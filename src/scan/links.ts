/** Sorts a submission's links into repos, demo videos and likely live demos. */
export interface RepoRef {
  owner: string;
  repo: string;
  url: string;
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
];

/** Hosts where hackathon demos are usually deployed; ranked first. */
const DEMO_HOSTS = [
  "vercel.app", "netlify.app", "pages.dev", "github.io", "onrender.com", "railway.app", "fly.dev", "herokuapp.com",
  "web.app", "firebaseapp.com", "surge.sh", "replit.app", "repl.co", "streamlit.app", "glitch.me", "deno.dev",
  "workers.dev", "amplifyapp.com", "azurewebsites.net", "up.railway.app", "hf.space", "lovable.app", "bolt.new",
];

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function parseRepo(url: string): RepoRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return undefined;
  const [owner, rawRepo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo || GITHUB_RESERVED.has(owner.toLowerCase())) return undefined;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return undefined;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function isVideo(host: string, path: string): boolean {
  if (hostMatches(host, "youtu.be") || hostMatches(host, "vimeo.com")) return true;
  if (hostMatches(host, "youtube.com")) return path.startsWith("/watch") || path.startsWith("/shorts") || path.startsWith("/embed");
  return hostMatches(host, "loom.com") && path.startsWith("/share");
}

function demoRank(host: string): number {
  return DEMO_HOSTS.some((d) => hostMatches(host, d)) ? 0 : 1;
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
