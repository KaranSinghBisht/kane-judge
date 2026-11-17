// Product grid on the home page.
import { addToCart, fetchProducts, formatPrice, renderCount } from "./cart.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function productCard(product) {
  const card = el("article", "product");
  const button = el("button", "", "Add to cart");
  button.type = "button";
  button.addEventListener("click", () => {
    addToCart(product.id);
    button.textContent = "Added ✓";
    setTimeout(() => (button.textContent = "Add to cart"), 1200);
  });
  card.append(el("h2", "", product.name), el("p", "", product.blurb), el("span", "price", formatPrice(product.priceCents)), button);
  return card;
}

async function main() {
  renderCount();
  const grid = document.getElementById("products");
  try {
    const products = await fetchProducts();
    grid.replaceChildren(...products.map(productCard));
  } catch (err) {
    grid.textContent = "Could not load products. Please refresh the page.";
    throw err;
  }
}

main();
