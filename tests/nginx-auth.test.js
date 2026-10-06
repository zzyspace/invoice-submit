import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const nginx = fs.readFileSync(path.join(root, "deploy/nginx/invoice-submit.conf"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "deploy/release.sh"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");

test("nginx protects invoice page and admin API with the shared gateway", () => {
  assert.match(nginx, /include \/etc\/nginx\/snippets\/admin-auth-gateway\.locations\.conf;/);
  assert.match(nginx, /location \^~ \/api\/admin\/ \{[\s\S]*admin-auth-invoice\.inc;[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8787;/);
  assert.ok(nginx.indexOf("location ^~ /api/admin/") < nginx.indexOf("location /api/"));
  for (const location of ["/invoice", "/invoice/"]) {
    const escaped = location.replaceAll("/", "\\/");
    assert.match(nginx, new RegExp(`location = ${escaped} \\{[\\s\\S]*?admin-auth-invoice\\.inc;`));
  }
});

test("nginx serves the canonical domain over HTTPS and redirects plain HTTP", () => {
  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /listen 443 ssl;/);
  assert.match(nginx, /server_name comeover\.cn;/);
  assert.match(nginx, /ssl_certificate \/etc\/letsencrypt\/live\/comeover\.cn\/fullchain\.pem;/);
  assert.match(nginx, /Strict-Transport-Security "max-age=31536000" always;/);
  assert.match(nginx, /return 308 https:\/\/comeover\.cn\$request_uri;/);
  assert.match(nginx, /location \^~ \/\.well-known\/acme-challenge\//);
});

test("nginx serves the COME OVER homepage at the canonical root", () => {
  assert.match(nginx, /location = \/ \{\s*try_files \/home\.html =404;\s*\}/);
  assert.match(nginx, /location = \/index\.html \{\s*return 404;\s*\}/);
});

test("invoice admin uses the shared admin top bar with a POST logout back to /invoice", () => {
  // The switcher, theme toggle and logout form come from admin-auth-gateway (/auth/accounts/admin-shell.*).
  assert.match(adminHtml, /<nav class="topbar" aria-label="发票中心导航" data-admin-center="invoice" data-return-to="\/invoice"><\/nav>/);
  const order = ["/auth/accounts/admin-shell.css", "/auth/accounts/admin-theme.js", "<style>", "/auth/accounts/admin-shell.js", "/auth/accounts/user-menu.js", "<nav class=\"topbar\""].map(text => adminHtml.indexOf(text));
  assert.ok(order.every(index => index > 0), "shared shell assets and placeholder are present");
  assert.deepEqual([...order].sort((x, y) => x - y), order, "theme before page styles; admin-shell.js before user-menu.js");
  // No local copies left to drift from the shared shell.
  assert.doesNotMatch(adminHtml, /center-switcher|centerSwitcher|theme-toggle|THEME_STORAGE_KEY|invoice-admin-theme/);
  assert.doesNotMatch(adminHtml, /\.topbar\s*\{/);
});

test("invoice admin keeps its page layout", () => {
  assert.match(adminHtml, /\.hero \{[^}]*align-content: center;[^}]*min-height: 145px;[^}]*margin: 0 -14px 0;[^}]*padding: 0 48px;/s);
  assert.match(adminHtml, /\.controls-grid \.field select \{[^}]*height: 46px;[^}]*min-height: 46px;[^}]*-webkit-appearance: none;/s);
  assert.match(adminHtml, /background-position:\s*calc\(100% - 18px\) 50%,\s*calc\(100% - 13px\) 50%;/);
});

test("invoice deployment leaves the shared Nginx entry to server-infra", () => {
  assert.doesNotMatch(deployScript, /\/etc\/nginx\/sites-(available|enabled)/);
  assert.doesNotMatch(deployScript, /\bnginx -t\b/);
  assert.doesNotMatch(deployScript, /systemctl reload nginx/);
});
