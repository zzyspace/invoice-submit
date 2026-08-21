import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const nginx = fs.readFileSync(path.join(root, "deploy/nginx/invoice-submit.conf"), "utf8");
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

test("invoice admin exposes a POST logout action", () => {
  assert.match(adminHtml, /<form class="logout-form" method="post" action="\/admin-logout">/);
  assert.match(adminHtml, /name="returnTo" value="\/invoice"/);
});
