import { addToCart, escapeHtml, fetchProducts, formatMoney, renderBadge } from "./cart.js";

const grid = document.querySelector("#products");

function productCard(product) {
  return `
    <article class="product">
      <h2>${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.blurb)}</p>
      <span class="price">${formatMoney(product.priceCents)}</span>
      <button type="button" data-id="${escapeHtml(product.id)}">Add to cart</button>
    </article>`;
}

function onAdd(event) {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  addToCart(button.dataset.id);
  renderBadge();
  button.textContent = "Added";
  setTimeout(() => (button.textContent = "Add to cart"), 900);
}

async function main() {
  renderBadge();
  const products = await fetchProducts();
  grid.innerHTML = products.map(productCard).join("");
  grid.addEventListener("click", onAdd);
}

main().catch((err) => {
  grid.textContent = "Sorry, the catalogue could not be loaded.";
  throw err;
});
