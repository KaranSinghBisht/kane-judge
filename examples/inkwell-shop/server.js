// Inkwell Supply Co.: a tiny demo shop. Zero dependencies: static files from ./public plus a small JSON API.
// Local development server; on Vercel the same API runs as functions in ./api.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createOrder, quote, readData } from "./lib/shop.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function api(req, res, handler) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const { status, json } = await handler(DATA_DIR, body);
  send(res, status, json);
}

async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 403, { error: "forbidden" });
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && pathname === "/api/products") return send(res, 200, await readData(DATA_DIR, "products.json"));
    if (req.method === "GET" && pathname === "/api/experiments") return send(res, 200, await readData(DATA_DIR, "experiments.json"));
    if (req.method === "POST" && pathname === "/api/quote") return await api(req, res, quote);
    if (req.method === "POST" && pathname === "/api/orders") return await api(req, res, createOrder);
    if (req.method === "GET") return await serveStatic(pathname, res);
    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    process.stderr.write(`request failed: ${err instanceof Error ? err.message : String(err)}\n`);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => process.stdout.write(`Inkwell shop on http://localhost:${PORT}\n`));
