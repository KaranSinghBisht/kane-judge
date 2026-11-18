import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

/** Small, dependency-free HTML helpers. Every string from a submission is untrusted: always escape it. */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

export function escapeHtml(text: string | number | undefined): string {
  return String(text ?? "").replace(/[&<>"'`]/g, (c) => ESCAPES[c] ?? c);
}

/** Returns the URL only when it is plain http(s); anything else (javascript:, data:, …) is refused. */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function link(url: string | undefined, label?: string): string {
  const href = safeHref(url);
  const text = escapeHtml(label ?? url ?? "");
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** A PNG/JPEG as a data URI so the scorecard is one self-contained file. Missing or huge files are skipped. */
export async function imageDataUri(absPath: string): Promise<string | undefined> {
  const type = IMAGE_TYPES[extname(absPath).toLowerCase()];
  if (!type) return undefined;
  try {
    const info = await stat(absPath);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return undefined;
    return `data:${type};base64,${(await readFile(absPath)).toString("base64")}`;
  } catch {
    return undefined;
  }
}

const CSS = `
:root{--bg:#f7f6f3;--card:#fff;--ink:#1d1f23;--muted:#5f6670;--line:#e4e1da;--accent:#2b5d4f;
--ok:#1f7a4d;--ok-bg:#e6f4ec;--bad:#b42318;--bad-bg:#fdecea;--warn:#a15c07;--warn-bg:#fdf3e1;--na:#5f6670;--na-bg:#eef0f2}
@media (prefers-color-scheme:dark){:root{--bg:#121315;--card:#1b1d20;--ink:#e9e7e2;--muted:#a3a8b0;--line:#2c2f34;--accent:#7cc4ad;
--ok:#6fd39b;--ok-bg:#16301f;--bad:#ff8a7d;--bad-bg:#3a1714;--warn:#f3b65d;--warn-bg:#352611;--na:#a3a8b0;--na-bg:#25282c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 64px}a{color:var(--accent)}
h1{font-size:28px;line-height:1.2;margin:0 0 6px}h2{font-size:17px;margin:32px 0 12px;letter-spacing:.01em}
.muted{color:var(--muted)}.links{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:6px 0 0}
.hero{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px}
.total{text-align:center;min-width:150px}.total b{display:block;font-size:44px;line-height:1}.total .of{font-size:24px;color:var(--muted)}
.total .rubric{display:block;font-size:12px;margin-top:8px;border-top:1px solid var(--line);padding-top:6px}.headline{font-size:16px;margin:10px 0 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:12px 0}
.badge{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:3px 10px;margin-right:8px;vertical-align:2px}
.proven{color:var(--ok);background:var(--ok-bg)}.broken{color:var(--bad);background:var(--bad-bg)}
.unverifiable{color:var(--warn);background:var(--warn-bg)}.untested,.withdrawn{color:var(--na);background:var(--na-bg)}
.fixed{color:var(--ok);background:var(--ok-bg);box-shadow:inset 0 0 0 1px var(--ok)}.struck{text-decoration:line-through;color:var(--muted)}
.fix{border-left:3px solid var(--ok);background:var(--ok-bg);border-radius:0 8px 8px 0;padding:8px 12px;margin:10px 0;font-size:14px}
.kane-bug{border-left:3px solid var(--line);padding:6px 12px;margin:10px 0;font-size:14px;border-radius:0 8px 8px 0}
.kane-bug.yes{border-color:var(--bad);background:var(--bad-bg)}.kane-bug.no{border-color:var(--warn);background:var(--warn-bg)}
.stamp{display:inline-block;font-size:13px;border-radius:8px;padding:5px 10px;margin:10px 0 0}
.stamp.ok{color:var(--ok);background:var(--ok-bg)}.stamp.bad{color:var(--bad);background:var(--bad-bg)}
.mode{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.claim{font-size:16px;font-weight:600}.source{border-left:3px solid var(--line);padding:2px 0 2px 12px;color:var(--muted);margin:10px 0;font-style:italic}
.shot{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px;margin-top:12px;background:#fff}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}figcaption{font-size:12px;color:var(--muted);margin-top:4px}
@media (max-width:640px){.pair{grid-template-columns:1fr}}
.replay{margin:0}.rp-bar{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:13px}
.rp-play{font:inherit;width:34px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.rp-seek{flex:0 0 150px;accent-color:var(--accent)}.rp-cap{color:var(--muted);min-width:0}.rp-cap.bad{color:var(--bad)}
.timeline{margin:12px 0 0;padding-left:20px;font-size:14px}.timeline li{margin:4px 0}
.score{display:grid;grid-template-columns:150px 1fr 56px;gap:12px;align-items:center;margin:10px 0}
.bar{height:8px;background:var(--line);border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}
.why{grid-column:2/4;font-size:13px;color:var(--muted);margin-top:-6px}
.flag{background:var(--bad-bg);color:var(--bad);border-radius:10px;padding:10px 14px;margin:8px 0}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.facts div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14px}
.facts b{display:block;font-size:12px;color:var(--muted);font-weight:600}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);font-size:14px}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
@media (max-width:640px){.hero{grid-template-columns:1fr}.score{grid-template-columns:1fr 48px}.score .bar{grid-column:1/3;order:3}.why{grid-column:1/3}}
@media print{body{background:#fff}.card,.hero{break-inside:avoid}}`;

/**
 * Steps through Kane's screenshots in a `.replay` figure. Without it the figure
 * still shows its last frame, so the page works with scripts off. It only ever
 * sets an image to a data: URI and writes captions as text.
 */
const REPLAY_SCRIPT = `document.querySelectorAll(".replay").forEach(function(el){var d;try{d=JSON.parse(el.querySelector(".rp-data").textContent)}catch(e){return}
if(!Array.isArray(d)||d.length<2)return;var img=el.querySelector("img.shot"),bar=el.querySelector(".rp-bar"),seek=el.querySelector(".rp-seek"),cap=el.querySelector(".rp-cap"),play=el.querySelector(".rp-play"),t=null;
function show(i){var f=d[i];if(!f||String(f.src).indexOf("data:image/")!==0)return;img.src=f.src;seek.value=i;cap.textContent="Step "+(i+1)+" of "+d.length+" \\u00b7 "+f.cap;cap.className="rp-cap"+(f.ok?"":" bad")}
function stop(){clearInterval(t);t=null;play.textContent="\\u25b6"}
play.addEventListener("click",function(){if(t)return stop();var i=+seek.value>=d.length-1?0:+seek.value;show(i);play.textContent="\\u275a\\u275a";t=setInterval(function(){i+=1;if(i>=d.length)return stop();show(i)},900)});
seek.addEventListener("input",function(){stop();show(+seek.value)});bar.hidden=false;show(d.length-1)});`;

export interface ReplayFrame {
  /** data: URI of Kane's screenshot for the step. */
  src: string;
  /** Kane's line about the step. */
  cap: string;
  ok: boolean;
}

/** JSON that is safe inside a <script> element: no "<" survives, so nothing can close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * Kane's screenshot for a claim. With two or more step frames it becomes a
 * replay: the last frame shows, and a slider steps through what Kane did.
 */
export function shotFigure(src: string, alt: string, caption?: string, frames?: ReplayFrame[]): string {
  const img = `<img class="shot" alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`;
  const note = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "";
  if (!frames || frames.length < 2) return caption ? `<figure>${img}${note}</figure>` : img;
  const last = frames.length - 1;
  return `<figure class="replay">${img}<div class="rp-bar" hidden><button type="button" class="rp-play" aria-label="Play Kane's steps">&#9654;</button>
<input type="range" class="rp-seek" min="0" max="${last}" value="${last}" aria-label="Kane's step"><span class="rp-cap"></span></div>
<script type="application/json" class="rp-data">${scriptJson(frames)}</script>${note}</figure>`;
}

export function page(title: string, body: string, meta: Record<string, string> = {}): string {
  const extra = Object.entries(meta)
    .map(([name, content]) => `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`)
    .join("");
  const script = body.includes('class="replay"') ? `<script>${REPLAY_SCRIPT}</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">${extra}<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main>${script}</body></html>\n`;
}

export function badge(status: string): string {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

export function scoreRow(label: string, score: number, max: number, why?: string, unverified?: string): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((score / max) * 100))) : 0;
  const gap = unverified ? `<span class="why"><b>Couldn't verify:</b> ${escapeHtml(unverified)}</span>` : "";
  return `<div class="score"><span>${escapeHtml(label)}</span><span class="bar"><i style="width:${pct}%"></i></span><b>${escapeHtml(`${score}/${max}`)}</b>${
    why ? `<span class="why">${escapeHtml(why)}</span>` : ""
  }${gap}</div>`;
}
