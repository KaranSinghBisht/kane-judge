// Cart helpers shared by every page. The cart lives in localStorage.
const KEY = "inkwell.cart";

export function loadCart() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(items) ? items.filter((i) => i && typeof i.id === "string" && i.qty > 0) : [];
  } catch {
    localStorage.removeItem(KEY);
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  renderCount(items);
}

export function addToCart(id) {
  const items = loadCart();
  const existing = items.find((i) => i.id === id);
  if (existing) existing.qty += 1;
  else items.push({ id, qty: 1 });
  saveCart(items);
  return items;
}

export function clearCart() {
  saveCart([]);
}

export function cartCount(items = loadCart()) {
  return items.reduce((n, i) => n + i.qty, 0);
}

export function renderCount(items = loadCart()) {
  const badge = document.getElementById("cart-count");
  if (badge) badge.textContent = String(cartCount(items));
}

export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function fetchProducts() {
  const res = await fetch("/api/products");
  if (!res.ok) throw new Error(`products request failed (${res.status})`);
  return res.json();
}
