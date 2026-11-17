import { clearCart, escapeHtml, fetchProducts, formatMoney, loadCart, renderBadge } from "./cart.js";

const SHIPPING_CENTS = 500;

const els = {
  body: document.querySelector("#checkout-body"),
  empty: document.querySelector("#empty"),
  items: document.querySelector("#items"),
  summary: document.querySelector("#order-summary"),
  promoForm: document.querySelector("#promo-form"),
  promoMessage: document.querySelector("#promo-message"),
  form: document.querySelector("#checkout-form"),
  pay: document.querySelector("#pay"),
  error: document.querySelector("#form-error"),
  confirmation: document.querySelector("#confirmation"),
  confirmationText: document.querySelector("#confirmation-text"),
};

const state = { products: [], cart: loadCart(), quote: null };

function lines() {
  return state.cart
    .map((item) => ({ ...item, product: state.products.find((p) => p.id === item.id) }))
    .filter((line) => line.product);
}

function localTotals() {
  const subtotal = lines().reduce((sum, l) => sum + l.product.priceCents * l.qty, 0);
  return { subtotal, discount: 0, shipping: SHIPPING_CENTS, total: subtotal + SHIPPING_CENTS, promoCode: null };
}

function renderItems() {
  els.items.innerHTML = lines()
    .map((l) => `<li><span>${escapeHtml(l.product.name)} × ${l.qty}</span><span>${formatMoney(l.product.priceCents * l.qty)}</span></li>`)
    .join("");
}

function renderSummary() {
  const t = state.quote ?? localTotals();
  const rows = [["Subtotal", formatMoney(t.subtotal), ""]];
  if (t.discount > 0) rows.push([`Discount (${escapeHtml(t.promoCode)})`, `−${formatMoney(t.discount)}`, " discount"]);
  rows.push(["Shipping", formatMoney(t.shipping), ""], ["Total", formatMoney(t.total), " total"]);
  els.summary.innerHTML = rows.map(([label, value, cls]) => `<div class="row${cls}"><span>${label}</span><span>${value}</span></div>`).join("");
}

async function applyPromo(event) {
  event.preventDefault();
  const code = new FormData(els.promoForm).get("promo")?.toString().trim().toUpperCase();
  if (!code) return;
  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: state.cart, promoCode: code }),
  });
  const data = await res.json();
  if (!res.ok) {
    els.promoMessage.textContent = data.error === "unknown promo code" ? `${code} isn't a valid code.` : "Couldn't apply that code.";
    return;
  }
  state.quote = data;
  els.promoMessage.textContent = `${code} applied: you save ${formatMoney(data.discount)}.`;
  renderSummary();
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

async function placeOrder(event) {
  event.preventDefault();
  if (!els.form.reportValidity()) return;
  const form = new FormData(els.form);
  els.error.hidden = true;
  els.pay.disabled = true;
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer: { name: form.get("name"), email: form.get("email") },
      items: state.cart,
      promoCode: state.quote?.promoCode ?? undefined,
    }),
  });
  const data = await res.json();
  els.pay.disabled = false;
  if (!res.ok) return showError(data.error ?? "Payment failed. Please try again.");
  clearCart();
  renderBadge();
  els.body.hidden = true;
  els.confirmationText.textContent = `Order #${data.orderId} is on its way. Paid ${formatMoney(data.total)}.`;
  els.confirmation.hidden = false;
}

async function main() {
  renderBadge();
  if (state.cart.length === 0) {
    els.body.hidden = true;
    els.empty.hidden = false;
    return;
  }
  state.products = await fetchProducts();
  renderItems();
  renderSummary();
  els.promoForm.addEventListener("submit", (event) => applyPromo(event).catch(() => (els.promoMessage.textContent = "Couldn't apply that code.")));
  els.form.addEventListener("submit", (event) => placeOrder(event).catch((err) => showError(err.message)));
}

main().catch((err) => showError(`Checkout is unavailable: ${err.message}`));
