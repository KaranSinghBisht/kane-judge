// Run against the static release directory or an explicitly supplied deployment URL.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

async function serveRelease() {
  const root = join(import.meta.dirname, "../public-demo");
  const files = new Set(await readdir(root, { recursive: true }));
  const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".txt": "text/plain", ".woff2": "font/woff2" };
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (!files.has(name)) return res.writeHead(404).end();
    try {
      const bytes = await readFile(join(root, name));
      res.writeHead(200, { "Content-Type": types[extname(name)] ?? "application/octet-stream" }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

const browser = await chromium.launch();
let server;
try {
  const url = process.argv[2] || `http://127.0.0.1:${(server = await serveRelease()).address().port}/`;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("link", { name: "Judge a submission" }).click();
  assert.match(await page.locator("#install").innerText(), /\/kane-judge:judge/);
  await page.getByRole("link", { name: "Promo updates the total" }).click();
  await page.locator("#claim-c3").filter({ hasText: /broken/i }).waitFor();
  await page.goBack();
  const before = page.getByRole("radio", { name: "Before repair" });
  const after = page.getByRole("radio", { name: "After repair" });
  await before.focus();
  await before.press("ArrowRight");
  assert.ok(await after.isChecked(), "Keyboard should select the repaired capture");
  await page.getByAltText(/repaired checkout capture/).evaluate(img => img.decode());
  assert.ok(await page.getByText("Total visible at $42.80", { exact: false }).isVisible());
  await after.press("ArrowLeft");
  assert.ok(await before.isChecked());
  const button = page.getByRole("button", { name: "Verify both evidence packs" });
  const result = page.locator("#pack-result");
  if (server) {
    // A stale or damaged download must never leave the visitor with a verified result.
    await page.route("**/deployed-*.evidence", route => route.fulfill({ status: 200, body: "truncated download" }), { times: 1 });
    await button.click();
    await result.filter({ hasText: /Verification failed.*differs from the recorded/ }).waitFor();
  }
  await button.click();
  await result.filter({ hasText: /Deployed shop: failed\. Repaired shop: passed with 3 passing assertions\. Identical test SHA-256: [0-9a-f]{64}/ }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Verified digest overflows on mobile");
  await page.getByText("Inspect the test and the agent’s repair", { exact: true }).click();
  for (const [label, expected] of [["Exact checkout test", /Verify.*Discount line/], ["One-line repair", /^\+.*"stopped"/m]]) {
    const href = await page.getByRole("link", { name: label }).getAttribute("href");
    const response = await page.request.get(new URL(href, url).href);
    assert.ok(response.ok(), label);
    assert.match(await response.text(), expected);
  }
  await page.getByRole("link", { name: "Failed control report" }).click();
  await page.locator("#claim-c4").filter({ hasText: /broken/i }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Call a broken claim proven" }).click();
  await page.locator("#out .refused").waitFor();
  await page.getByRole("link", { name: "Watch the failed and repaired checkout" }).click();
  const replay = page.locator("#claim-c4 .replay").first();
  await replay.locator(".rp-cap").filter({ hasText: /^Step / }).waitFor();
  await replay.getByRole("slider").press("Home");
  await replay.locator(".rp-cap").filter({ hasText: /^Step 1 of/ }).waitFor();
  await replay.locator("img").first().evaluate(img => img.decode());
  assert.deepEqual(errors, []);
  console.log(`Hosted judge path passed at ${url}: both pack hashes, identical test, opposite outcomes, source links, rejected verdict and keyboard replay.`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
