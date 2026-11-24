// Reproduce the checkout defect on two local copies and exercise the judge-facing UI.
// Run after npm ci and npx playwright-core install chromium --only-shell.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const patch = join(root, "examples/preflight/inkwell-shop/checkout-repair.patch");

async function checkout(browser, shop, repaired) {
  const server = spawn(process.execPath, ["server.js"], { cwd: shop, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "inherit"] });
  const exited = once(server, "exit");
  try {
    const ready = await Promise.race([
      once(server.stdout, "data", { signal: AbortSignal.timeout(10_000) }).then(([data]) => String(data)),
      exited.then(([code]) => { throw new Error(`Shop exited before startup (${code})`); }),
    ]);
    const port = ready.match(/localhost:(\d+)/)?.[1];
    assert.ok(port, "Shop must report its listening port");
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(8_000);
      const warnings = [];
      page.on("console", msg => warnings.push(msg.text()));
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator("article").filter({ hasText: "Brass Pen" }).getByRole("button").click();
      await page.locator("#cart-count").filter({ hasText: /^1$/ }).waitFor();
      await page.getByRole("link", { name: /^Cart/ }).click();
      const total = page.locator("#order-summary .total");
      await total.getByText("$47.00", { exact: true }).waitFor();
      await page.getByLabel("Promo code").fill("SAVE10");
      await page.getByRole("button", { name: "Apply" }).click();
      await page.getByRole("status").filter({ hasText: "SAVE10 applied: you save $4.20." }).waitFor();
      const discount = page.locator("#order-summary .discount");
      assert.match(await discount.innerText(), /SAVE10[\s\S]*4\.20/);
      if (repaired) {
        await total.getByText("$42.80", { exact: true }).waitFor();
      } else {
        await total.waitFor({ state: "detached" });
        assert.ok(warnings.some(text => text.includes("compact-order-summary: limit-rows removed 1 of 4 rows")));
      }
      console.log(repaired ? "Repaired checkout: SAVE10 shows Total $42.80." : "Original checkout: SAVE10 removes Total. The experiment logged the removed row.");
    } finally { await page.close(); }
  } finally {
    server.kill();
    await exited;
  }
}

async function scorecards(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(pathToFileURL(join(root, "docs/index.html")).href);
    const buttons = page.locator("#presets button");
    assert.equal(await buttons.count(), 8);
    for (let i = 0; i < 8; i++) {
      await buttons.nth(i).click();
      await page.locator(i === 0 ? "#out .accepted" : "#out .refused").waitFor();
    }
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(await fits(), "Playground overflows on a phone");
    await page.getByRole("link", { name: "Replay the repaired claim" }).click();
    const claim = page.locator("#claim-c4");
    const replay = claim.locator(".replay").first();
    await replay.locator(".rp-seek").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await replay.locator(".rp-cap").filter({ hasText: /^Step 2 of/ }).waitFor();
    await replay.locator("img").first().evaluate(async image => { await image.decode(); });
    assert.ok(await fits(), "Scorecard overflows on a phone");
    assert.deepEqual(errors, []);
    console.log("Mobile scorecard: eight playground verdicts, repaired-claim link, keyboard replay and evidence image passed.");
  } finally { await page.close(); }
}

const browser = await chromium.launch();
const dir = await mkdtemp(join(tmpdir(), "kane-checkout-"));
try {
  await cp(join(root, "examples/inkwell-shop"), dir, { recursive: true, filter: path => !basename(path).startsWith(".") && basename(path) !== "node_modules" });
  await checkout(browser, dir, false);
  execFileSync("git", ["apply", patch], { cwd: dir });
  await checkout(browser, dir, true);
  await scorecards(browser);
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
