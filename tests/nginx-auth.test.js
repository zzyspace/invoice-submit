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

test("invoice admin exposes a POST logout action", () => {
  assert.match(adminHtml, /<form class="logout-form" method="post" action="\/admin-logout">/);
  assert.match(adminHtml, /name="returnTo" value="\/invoice"/);
});
