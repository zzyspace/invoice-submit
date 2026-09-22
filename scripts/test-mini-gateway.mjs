import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real portal + real gateway integration; all accounts and DB files are ephemeral.
// Run after build: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-mini-gateway.mjs
// Optional: MINI_GATEWAY_ROOT, MINI_CHROME_PATH, MINI_SCREENSHOT_DIR, MINI_INVOICE_ROOT.
const invoiceRoot = path.resolve(process.env.MINI_INVOICE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const gatewayRoot = path.resolve(process.env.MINI_GATEWAY_ROOT || path.join(invoiceRoot, '..', 'admin-auth-gateway'));
const portal = fs.readFileSync(path.join(invoiceRoot, 'public', 'mini.html'));
assert.deepEqual(portal, fs.readFileSync(path.join(invoiceRoot, 'mini.html')), 'Run the invoice build: source mini.html and public/mini.html must match.');
const gatewayImport = name => import(pathToFileURL(path.join(gatewayRoot, 'server', name)).href);
const [{ createAccountStore }, { createSessionDatabase }, { createApp }, { loadConfig }, { parseCookies }] = await Promise.all([
  gatewayImport('account-store.js'), gatewayImport('database.js'), gatewayImport('app.js'), gatewayImport('config.js'), gatewayImport('security.js'),
]);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.MINI_SCREENSHOT_DIR ? path.resolve(process.env.MINI_SCREENSHOT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'mini-gateway-results-'));
fs.mkdirSync(out, { recursive: true });
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-gateway-db-'));
let accounts, database, server, browser;
const checks = [], errors = [];
const password = randomBytes(24).toString('base64url');
try {
accounts = createAccountStore({ stateDir });
database = createSessionDatabase({ stateDir });
const roleIds = ['submit-only', 'accounts-only', 'full'];
for (const accountId of roleIds) accounts.createAccount({ accountId, username: accountId, password }, { actor: 'isolated-fixture' });
const grant = (accountId, app, permissions, config) => accounts.putAccess({ accountId, app, role: app === 'expense' ? 'manager' : 'admin', enabled: true, permissions, config }, { actor: 'isolated-fixture', expectedVersion: 0 });
grant('submit-only', 'expense', ['report:submit'], { viewScope: { ownership: 'self', stores: [], channels: [] }, submitScope: { stores: ['fuzzy'], channels: ['reimbursement_fuzzy_manager'] } });
grant('full', 'invoice', ['submission:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'staff', ['employee:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'store', ['coupon:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'expense', ['report:view', 'report:submit'], { viewScope: { ownership: 'any', stores: 'all', channels: 'all' }, submitScope: { stores: 'all', channels: 'all' } });
const config = loadConfig({ ADMIN_AUTH_MODE: 'unified', ADMIN_AUTH_INTERNAL_TOKEN: randomBytes(32).toString('hex'), ADMIN_AUTH_MANAGEMENT_ACCOUNT_IDS: 'accounts-only,full', ADMIN_AUTH_COOKIE_SECURE: 'false', ADMIN_AUTH_COOKIE_NAME: 'admin_session' });
const { app, sessions } = createApp({ config, database, accounts });
server = http.createServer((request, response) => {
  if (request.url.split('?')[0] === '/mini.html') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(portal); return; }
  const route = request.url.split('?')[0];
  const destination = {
    '/invoice': ['invoice', 'submission:view'], '/staff': ['staff', 'employee:view'],
    '/store': ['store', 'coupon:view'], '/expense': ['expense', 'report:view'],
    '/expense/submit': ['expense', 'report:submit'],
  }[route];
  if (destination) {
    const token = parseCookies(request.headers.cookie).get(config.cookie.name);
    const authorization = sessions.resolve(token, destination[0]);
    const status = !authorization ? 401 : authorization.access.permissions.includes(destination[1]) ? 200 : 403;
    response.writeHead(status, { 'Content-Type': 'text/plain' });
    response.end('Permission-gated local destination fixture; business workflow is out of scope.'); return;
  }
  app(request, response);
});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.MINI_CHROME_PATH ? { executablePath: process.env.MINI_CHROME_PATH } : { channel: 'chrome' }) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const state = async name => { await page.goto(base + '/mini.html'); await page.waitForFunction(() => document.querySelector('#management-panel').dataset.state !== 'loading'); assert.equal(await page.locator('#management-panel').getAttribute('data-state'), name); };
  const links = () => page.locator('#management-grid a').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.app, node.getAttribute('href')])));
  await state('anonymous'); assert.equal(Object.keys(await links()).length, 6); checks.push('anonymous portal renders six choices including explicit expense submission login');
  await page.locator('[data-app="expense"]').click();
  assert.equal(new URL(page.url()).pathname, '/login');
  // Invalid double-submit token must not create a login session.
  const invalidLogin = await context.request.post(base + '/login', { form: { username: 'submit-only', password, csrfToken: 'invalid', returnTo: '/expense' }, maxRedirects: 0 });
  assert.equal(invalidLogin.status(), 403); checks.push('real login endpoint rejects invalid CSRF token');
  async function login(id, destination, entryApp) {
    await context.clearCookies();
    await state('anonymous');
    await page.locator(`[data-app="${entryApp}"]`).click();
    const loginUrl = new URL(page.url());
    assert.equal(loginUrl.pathname, '/login');
    assert.equal(loginUrl.searchParams.get('returnTo'), destination);
    assert.equal(await page.locator('input[name="returnTo"]').inputValue(), destination);
    await page.locator('#username').fill(id); await page.locator('#password').fill(password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/login'),
      page.waitForURL(base + destination),
      page.getByRole('button', { name: '登录', exact: true }).click(),
    ]);
    assert.equal(loginResponse.status(), 303);
    assert.equal(loginResponse.headers().location, destination);
    assert.equal((await context.request.get(base + destination)).status(), 200);
    const cookie = (await context.cookies()).find(cookie => cookie.name === 'admin_session');
    assert.ok(cookie); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Lax');
    assert.equal(await page.evaluate(() => document.cookie.includes('admin_session=')), false);
    await state('authenticated');
  }
  await login('submit-only', '/expense/submit', 'expense-submit');
  assert.deepEqual(await links(), { expense: '/expense/submit' });
  assert.match(await page.locator('[data-app="expense"]').innerText(), /提交报账/);
  await page.screenshot({ path: path.join(out, 'auth-portal-submit-only.png'), fullPage: true });
  checks.push('actual anonymous expense-submit link and real form login redirect to /expense/submit with valid Cookie');
  assert.equal((await context.request.get(base + '/expense')).status(), 403);
  checks.push('submit-only fixture denies expense dashboard, so the regression cannot hide behind an unrestricted stub');
  await login('accounts-only', '/auth/accounts', 'accounts'); assert.deepEqual(await links(), { accounts: '/auth/accounts' });
  checks.push('management-only account renders accounts entry without business grants');
  await login('full', '/invoice', 'invoice');
  assert.deepEqual(await links(), { store: '/store', expense: '/expense', invoice: '/invoice', staff: '/staff', accounts: '/auth/accounts' });
  await page.screenshot({ path: path.join(out, 'auth-portal-full.png'), fullPage: true });
  checks.push('full account renders all four actual destinations and management entry');
  const storeGrant = accounts.getAccess('full', 'store');
  accounts.putAccess({ ...storeGrant, accountId: 'full', enabled: false }, { actor: 'isolated-fixture', expectedVersion: storeGrant.version });
  await page.locator('#session-retry').click();
  await page.waitForFunction(() => !document.querySelector('[data-app="store"]') && document.querySelector('#management-panel').dataset.state === 'authenticated');
  assert.equal(Object.keys(await links()).length, 4); checks.push('application revocation removes only the revoked store entry after session refresh');
  // A forged foreign Origin must fail without ending this browser session.
  const cookieString = (await context.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  const invalidLogout = await fetch(base + '/logout', { method: 'POST', redirect: 'manual', headers: { Origin: 'https://untrusted.invalid', Cookie: cookieString, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'returnTo=%2Finvoice' });
  assert.equal(invalidLogout.status, 403); checks.push('logout rejects a foreign Origin');
  await page.evaluate(async () => { await fetch('/logout', { method: 'POST', body: new URLSearchParams({ returnTo: '/invoice' }) }); });
  await state('anonymous'); assert.ok(!(await context.cookies()).find(cookie => cookie.name === 'admin_session')); checks.push('same-origin browser logout clears Cookie and returns portal to anonymous');
  await login('submit-only', '/expense/submit', 'expense-submit');
  const account = accounts.getAccount('submit-only');
  accounts.updateAccount('submit-only', { enabled: false }, { actor: 'isolated-fixture', expectedVersion: account.version });
  await state('anonymous'); checks.push('account disable invalidates existing session and portal falls back to login');
  assert.deepEqual(errors, []); checks.push('no page JavaScript errors');
  const result = { passed: checks.length, checks, limitations: ['Chrome over local HTTP with test-only Secure=false; production Secure/HTTPS and actual Nginx not exercised.', 'Portal and gateway/session/account code are actual; other destination pages are fixtures gated by real session grants, not full business services.', 'No production data or requests; not a WeChat or native-device test.'] };
  fs.writeFileSync(path.join(out, 'auth-portal-integration-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, outputDirectory: out }, null, 2));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  database?.close(); accounts?.close(); fs.rmSync(stateDir, { recursive: true, force: true });
}
