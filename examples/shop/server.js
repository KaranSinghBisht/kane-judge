// Inkwell Supply Co. — a tiny demo shop for Kane Gate.
// Zero dependencies: static files from ./public plus a small JSON API.
// Files are read on every request (no caching), so edits show up immediately.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 4173;
const SHIPPING_CENTS = 500;

// Promo codes the payments backend accepts (shipped before the storefront UI).
const PROMOS = { SAVE10: { percentOffSubtotal: 10 } };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readJson(name) {
  return JSON.parse(await readFile(join(ROOT, "data", name), "utf8"));
}

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

function priceOrder(products, items, promoCode) {
  let subtotal = 0;
  for (const item of items) {
    const product = products.find((p) => p.id === item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) return { error: `invalid item ${item.id}` };
    subtotal += product.priceCents * qty;
  }
  const promo = promoCode ? PROMOS[String(promoCode).toUpperCase()] : undefined;
  if (promoCode && !promo) return { error: "unknown promo code" };
  const discount = promo ? Math.round((subtotal * promo.percentOffSubtotal) / 100) : 0;
  return { subtotal, discount, total: subtotal - discount + SHIPPING_CENTS };
}

async function createOrder(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const { customer, items, promoCode } = body ?? {};
  if (!customer?.name || !/^\S+@\S+\.\S+$/.test(customer?.email ?? "")) return send(res, 422, { error: "name and a valid email are required" });
  if (!Array.isArray(items) || items.length === 0) return send(res, 422, { error: "the cart is empty" });
  const priced = priceOrder(await readJson("products.json"), items, promoCode);
  if (priced.error) return send(res, 422, { error: priced.error });
  const orderId = `INK-${Math.floor(10000 + Math.random() * 90000)}`;
  send(res, 201, { orderId, ...priced });
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
    if (req.method === "GET" && pathname === "/api/products") return send(res, 200, await readJson("products.json"));
    if (req.method === "GET" && pathname === "/api/experiments") return send(res, 200, await readJson("experiments.json"));
    if (req.method === "POST" && pathname === "/api/orders") return await createOrder(req, res);
    if (req.method === "GET") return await serveStatic(pathname, res);
    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    process.stderr.write(`request failed: ${err instanceof Error ? err.message : String(err)}\n`);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => process.stdout.write(`Inkwell shop on http://localhost:${PORT}\n`));
