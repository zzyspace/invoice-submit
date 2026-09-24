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
const roleIds = ['submit-only', 'accounts-only', 'full', 'store-only', 'staff-only', 'invoice-only', 'no-grants'];
for (const accountId of roleIds) accounts.createAccount({ accountId, username: accountId, password }, { actor: 'isolated-fixture' });
const grant = (accountId, app, permissions, config) => accounts.putAccess({ accountId, app, role: app === 'expense' ? 'manager' : 'admin', enabled: true, permissions, config }, { actor: 'isolated-fixture', expectedVersion: 0 });
grant('submit-only', 'expense', ['report:submit'], { viewScope: { ownership: 'self', stores: [], channels: [] }, submitScope: { stores: ['fuzzy'], channels: ['reimbursement_fuzzy_manager'] } });
grant('full', 'invoice', ['submission:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'staff', ['employee:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'store', ['coupon:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('full', 'expense', ['report:view', 'report:submit'], { viewScope: { ownership: 'any', stores: 'all', channels: 'all' }, submitScope: { stores: 'all', channels: 'all' } });
grant('store-only', 'store', ['coupon:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('staff-only', 'staff', ['employee:view'], { viewScope: { ownership: 'any', stores: 'all' } });
grant('invoice-only', 'invoice', ['submission:view'], { viewScope: { ownership: 'any', stores: 'all' } });
const config = loadConfig({ ADMIN_AUTH_MODE: 'unified', ADMIN_AUTH_INTERNAL_TOKEN: randomBytes(32).toString('hex'), ADMIN_AUTH_MANAGEMENT_ACCOUNT_IDS: 'accounts-only,full', ADMIN_AUTH_COOKIE_SECURE: 'false', ADMIN_AUTH_COOKIE_NAME: 'admin_session' });
const { app, sessions } = createApp({ config, database, accounts, exchangeWechatCode:async()=> 'test-openid-only' });
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

  config.wechat = { enabled:true, appId:'wx7b76ebc181d2f07e', secret:'fixture-only', origin:base };
  await page.route('https://res.wx.qq.com/open/js/jweixin-1.6.0.js', route => route.fulfill({contentType:'application/javascript',body:`window.wx={miniProgram:{getEnv:fn=>fn({miniprogram:true}),navigateTo:options=>{window.fixtureNativeUrl=options.url;options.success();}}};`}));
  await page.goto(base+'/mini.html?wechatLogin=1');
  await page.getByRole('button',{name:'微信登录',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'wechat-login-options.png'),fullPage:true});
  await page.getByRole('button',{name:'微信登录',exact:true}).click();
  await page.waitForFunction(()=>Boolean(window.fixtureNativeUrl));
  const nativeUrl=await page.evaluate(()=>window.fixtureNativeUrl);
  const flowId=new URL(nativeUrl,'http://fixture').searchParams.get('flowId');
  // Native request deliberately has no browser Cookie.
  const exchange=await fetch(base+'/auth/wechat/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flowId,code:'local-code'})});
  assert.equal(exchange.status,200);
  await page.goto(base+'/auth/wechat/complete?flowId='+flowId);
  await page.getByRole('heading',{name:'首次绑定微信',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'wechat-binding-form.png'),fullPage:true});
  await page.locator('#username').fill('submit-only'); await page.locator('#password').fill(password);
  const bindingReply = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/login'));
  await page.getByRole('button',{name:'登录并绑定微信',exact:true}).click();
  const reply = await bindingReply;
  if (reply.status() !== 303) console.log('Binding diagnostic', reply.status(), reply.request().headers().origin, await page.locator('body').innerText());
  assert.equal(reply.status(),303);
  await page.waitForURL(base+'/mini.html?wechatLogin=1');
  await page.locator('#management-panel[data-state="authenticated"]').waitFor();
  assert.equal(await page.locator('#management-grid a').count(),1);
  assert.equal(await page.locator('#management-grid a').getAttribute('href'),'/expense/submit');
  const sessionCookie=(await context.cookies()).find(cookie=>cookie.name==='admin_session');
  assert.ok(sessionCookie.httpOnly);assert.equal(sessionCookie.sameSite,'Lax');
  assert.equal(await page.evaluate(()=>document.cookie.includes('admin_session=')),false);
  // Submit the same shared logout form used by every business backend.
  assert.ok((await context.cookies()).some(cookie=>cookie.name==='admin_mini_ui' && cookie.value==='wechat-v1'));
  await page.evaluate(() => {
    const form=document.createElement('form');form.method='POST';form.action='/logout';
    const input=document.createElement('input');input.name='returnTo';input.value='/expense/submit';form.append(input);document.body.append(form);form.submit();
  });
  await page.waitForURL(base+'/mini.html?wechatLogin=1');
  await page.locator('#management-panel[data-state="anonymous"]').waitFor();
  await page.getByRole('button',{name:'微信登录',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'账号密码登录',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#management-grid a').count(),0);
  assert.ok(!(await context.cookies()).some(cookie=>cookie.name==='admin_session'));
  // Explicitly selecting password login must not bounce back to the chooser.
  await page.getByRole('link',{name:'账号密码登录',exact:true}).click();
  await page.waitForURL(base+'/login?returnTo=%2Fmini.html');
  assert.equal(await page.locator('#password').isVisible(),true);
  await context.clearCookies();
  await page.goto(base+'/mini.html?wechatLogin=1');
  await page.getByRole('button',{name:'微信登录',exact:true}).click();
  await page.waitForFunction(()=>Boolean(window.fixtureNativeUrl));
  const secondFlow = new URL(await page.evaluate(()=>window.fixtureNativeUrl),'http://fixture').searchParams.get('flowId');
  assert.equal((await fetch(base+'/auth/wechat/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flowId:secondFlow,code:'another-code'})})).status,200);
  await page.goto(base+'/auth/wechat/complete?flowId='+secondFlow);
  await page.waitForURL(base+'/mini.html?wechatLogin=1');
  await page.locator('#management-panel[data-state="authenticated"]').waitFor();
  assert.equal(await page.locator('#management-grid a').getAttribute('href'),'/expense/submit');
  await page.screenshot({path:path.join(out,'wechat-binding-browser.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['new-shell capability and enabled flag show WeChat option','H5 flow Cookie and native code exchange remain separate','real CSRF-protected old password form binds the old account','original HttpOnly Cookie and submit-only permissions preserved','logout destroys session and displays both login methods; explicit password choice does not redirect back'],limitations:['WeChat code exchange and JS-SDK mocked; not native iPhone/Android proof'],outputDirectory:out},null,2));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  database?.close(); accounts?.close(); fs.rmSync(stateDir, { recursive: true, force: true });
}
