// Shop logic shared by the local server (server.js) and the Vercel functions (api/*.js).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SHIPPING_CENTS = 500;

// Promo codes the payments backend accepts.
const PROMOS = { SAVE10: { percentOffSubtotal: 10 } };

export async function readData(dataDir, name) {
  return JSON.parse(await readFile(join(dataDir, name), "utf8"));
}

export function priceOrder(products, items, promoCode) {
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

/** POST /api/quote: price a cart, optionally with a promo code. */
export async function quote(dataDir, body) {
  const { items, promoCode } = body ?? {};
  if (!Array.isArray(items) || items.length === 0) return { status: 422, json: { error: "the cart is empty" } };
  const priced = priceOrder(await readData(dataDir, "products.json"), items, promoCode);
  if (priced.error) return { status: 422, json: { error: priced.error } };
  return { status: 200, json: { ...priced, shipping: SHIPPING_CENTS, promoCode: promoCode ? String(promoCode).toUpperCase() : null } };
}

/** POST /api/orders: price the cart again on the server and confirm the order (no payment is taken). */
export async function createOrder(dataDir, body) {
  const { customer, items, promoCode } = body ?? {};
  if (!customer?.name || !/^\S+@\S+\.\S+$/.test(customer?.email ?? "")) return { status: 422, json: { error: "name and a valid email are required" } };
  if (!Array.isArray(items) || items.length === 0) return { status: 422, json: { error: "the cart is empty" } };
  const priced = priceOrder(await readData(dataDir, "products.json"), items, promoCode);
  if (priced.error) return { status: 422, json: { error: priced.error } };
  const orderId = `INK-${Math.floor(10000 + Math.random() * 90000)}`;
  return { status: 201, json: { orderId, ...priced } };
}
