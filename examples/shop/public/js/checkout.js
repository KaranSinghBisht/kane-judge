// Checkout page: cart lines, order summary, and payment.
// Card details are only validated here; they are never sent to the server.
import { clearCart, fetchProducts, formatPrice, loadCart, renderCount } from "./cart.js";

const SHIPPING_CENTS = 500;
const $ = (id) => document.getElementById(id);

function row(label, value, className = "row") {
  const div = document.createElement("div");
  div.className = className;
  const name = document.createElement("span");
  name.textContent = label;
  const amount = document.createElement("span");
  amount.textContent = value;
  div.append(name, amount);
  return div;
}

function renderItems(lines) {
  $("items").replaceChildren(
    ...lines.map(({ product, qty }) => {
      const li = document.createElement("li");
      li.append(row(`${product.name} × ${qty}`, formatPrice(product.priceCents * qty), "line"));
      return li;
    }),
  );
}

function renderSummary(subtotal) {
  $("order-summary").replaceChildren(
    row("Subtotal", formatPrice(subtotal)),
    row("Shipping", formatPrice(SHIPPING_CENTS)),
    row("Total", formatPrice(subtotal + SHIPPING_CENTS), "row total"),
  );
}

function cartLines(products) {
  return loadCart()
    .map(({ id, qty }) => ({ product: products.find((p) => p.id === id), qty }))
    .filter((line) => line.product);
}

function showError(message) {
  $("form-error").textContent = message;
  $("form-error").hidden = !message;
}

function cardProblem(form) {
  const digits = form.card.value.replace(/\s+/g, "");
  if (!/^\d{12,19}$/.test(digits)) return "Enter a valid card number.";
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(form.expiry.value.trim())) return "Enter the expiry as MM/YY.";
  if (!/^\d{3,4}$/.test(form.cvc.value.trim())) return "Enter the 3 or 4 digit CVC.";
  return "";
}

async function placeOrder(form, lines) {
  const body = {
    customer: { name: form.name.value.trim(), email: form.email.value.trim() },
    items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
  };
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `order failed (${res.status})`);
  return data;
}

function showConfirmation(order, name) {
  $("checkout-body").hidden = true;
  $("confirmation").hidden = false;
  $("confirmation-text").textContent = `Thanks, ${name}! Order ${order.orderId} is confirmed. Total charged: ${formatPrice(order.total)}.`;
  clearCart();
}

async function onSubmit(event, lines) {
  event.preventDefault();
  const form = event.currentTarget;
  const problem = cardProblem(form);
  showError(problem);
  if (problem) return;
  $("pay").disabled = true;
  try {
    showConfirmation(await placeOrder(form, lines), form.name.value.trim());
  } catch (err) {
    showError(err instanceof Error ? err.message : "Payment failed. Please try again.");
  } finally {
    $("pay").disabled = false;
  }
}

async function main() {
  renderCount();
  const lines = cartLines(await fetchProducts());
  if (lines.length === 0) {
    $("empty").hidden = false;
    $("checkout-body").hidden = true;
    return;
  }
  renderItems(lines);
  renderSummary(lines.reduce((sum, { product, qty }) => sum + product.priceCents * qty, 0));
  $("checkout-form").addEventListener("submit", (event) => onSubmit(event, lines));
}

main();
