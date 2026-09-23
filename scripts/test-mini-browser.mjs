// Desktop browser checks with a fixture gateway, never production credentials/data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const html = await fs.readFile(new URL("../public/mini.html", import.meta.url));
const source = await fs.readFile(new URL("../mini.html", import.meta.url));
assert.ok(html.equals(source), "mini.html 与 public/mini.html 不一致；请先运行 npm run build，避免验证旧页面。");
let gateway = { status: 401, body: { success: false } };
const server = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/mini.html" || pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html);
  } else if (pathname === "/auth/api/session") {
    response.writeHead(gateway.status, { "Content-Type": "application/json" }); response.end(JSON.stringify(gateway.body));
  } else if (pathname === "/favicon.ico") {
    response.writeHead(204); response.end();
  } else {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("本地入口预览不连接业务服务。完整导航请在联调环境验收。");
  }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.MINI_PREVIEW_PORT || 0), "127.0.0.1", resolve); });
const url = `http://127.0.0.1:${server.address().port}/mini.html`;
if (process.argv.includes("--serve")) {
  console.log(`Local entry preview (fixture 401; business links need integration environment): ${url}`);
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
} else {
  let browser;
  try {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ headless: true, ...(process.env.MINI_CHROME_PATH ? { executablePath: process.env.MINI_CHROME_PATH } : { channel: "chrome" }) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = (value) => page.locator(`#management-panel[data-state="${value}"]`).waitFor();
    const links = () => page.locator("#management-grid a").evaluateAll((nodes) => nodes.map((node) => [node.dataset.app, node.getAttribute("href")]));
    const load = async (fixture, expected) => { gateway = fixture; await page.goto(url); await state(expected); };
    const session = (destinations, canManageAccounts = false) => ({ status: 200, body: { success: true, destinations, canManageAccounts } });
    const checks = [];
    await load({ status: 401, body: { success: false } }, "anonymous");
    assert.deepEqual(await links(), []);
    assert.equal(await page.locator('#login-link').isVisible(), true);
    assert.equal(await page.locator('#login-link').getAttribute('href'), '/login?returnTo=%2Fmini.html');
    assert.equal(await page.getByRole('heading', { name: '业务管理', exact: true }).count(), 0);
    checks.push("anonymous shows only login guidance; no business links or business heading");
    await load(session({ store: "/store", expense: "/expense", invoice: "/invoice", staff: "/staff" }, true), "authenticated");
    assert.equal((await links()).length, 5);
    assert.equal(await page.locator("#login-link").isVisible(), false);
    await load(session({ expense: "/expense/submit" }), "authenticated");
    assert.deepEqual(await links(), [["expense", "/expense/submit"]]);
    assert.equal(await page.locator("#management-grid .entry-title").textContent(), "提交报账");
    checks.push("gateway destinations preserved; submit-only expense grant");
    await load(session({}, true), "authenticated");
    assert.deepEqual(await links(), [["accounts", "/auth/accounts"]]);
    await load(session({}), "authenticated");
    assert.deepEqual(await links(), []);
    assert.match(await page.locator("#session-status").textContent(), /暂无可进入/);
    checks.push("accounts-only and empty grants; no implicit role access");
    await load(session({ store: "https://example.com/", expense: "//example.com/", invoice: "/invoice?token=secret", staff: "javascript:alert(1)", unknown: "/store", accounts: "/auth/accounts" }), "authenticated");
    assert.deepEqual(await links(), []);
    checks.push("unrecognized/external/query destinations rejected; accounts flag required");
    await load({ status: 503, body: { success: false } }, "error");
    assert.deepEqual(await links(), []);
    gateway = session({ store: "/store" });
    await page.getByRole("button", { name: "重新检查登录状态" }).click();
    await state("authenticated");
    assert.deepEqual(await links(), [["store", "/store"]]);
    await load({ status: 200, body: { success: true, destinations: [] } }, "error");
    checks.push("gateway failures and malformed responses fail closed; explicit retry");
    await load(session({ store: "/store" }), "authenticated");
    gateway = { status: 401, body: { success: false } };
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await state("anonymous");
    assert.deepEqual(await links(), []);
    assert.equal(await page.locator("#login-link").isVisible(), true);
    checks.push("back-forward cache return revalidates revoked session");
    await load({ status: 401, body: { success: false } }, "anonymous");
    const screenshots = process.env.MINI_SCREENSHOT_DIR || await fs.mkdtemp(path.join(os.tmpdir(), "comeover-mini-browser-"));
    await fs.mkdir(screenshots, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `horizontal overflow at ${width}`);
      await page.screenshot({ path: path.join(screenshots, `entry-${width}-light.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "切换深色外观" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.screenshot({ path: path.join(screenshots, "entry-390-dark.png"), fullPage: true });
    await page.reload(); await state("anonymous");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    checks.push("320/390/1440 layout; dark appearance and preference persistence");
    const blockedStorage = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await blockedStorage.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage unavailable"); } }); });
    const blockedPage = await blockedStorage.newPage();
    blockedPage.on("pageerror", (error) => errors.push(error.message));
    await blockedPage.goto(url); await blockedPage.locator('#management-panel[data-state="anonymous"]').waitFor();
    await blockedPage.getByRole("button", { name: "切换深色外观" }).click();
    assert.equal(await blockedPage.locator("html").getAttribute("data-theme"), "dark");
    await blockedStorage.close();
    checks.push("storage-denied environment still loads and switches appearance");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: checks, screenshots, evidence: "Desktop Chrome with fixture gateway; not WeChat, live authorization, or real-device proof." }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
