import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import Database from "better-sqlite3";
import multer from "multer";

import { createApp } from "../server/app.js";
import { buildAttachmentRelativePath, createSubmissionRecord } from "../server/submissions.js";

const schemaSql = `
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  invoice_type TEXT NOT NULL,
  invoice_title TEXT NOT NULL,
  tax_number TEXT,
  email TEXT NOT NULL,
  contact TEXT,
  note TEXT,
  attachment_path TEXT NOT NULL,
  attachment_name TEXT NOT NULL,
  attachment_content_type TEXT NOT NULL,
  attachment_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "invoice-submit-test-"));
}

function createValidFormData() {
  const formData = new FormData();
  formData.set("invoiceType", "enterprise");
  formData.set("invoiceTitle", "上海示例科技有限公司");
  formData.set("taxNumber", "");
  formData.set("email", "finance@example.com");
  formData.set("contact", "13800000000");
  formData.set("note", "测试备注");
  formData.set(
    "attachment",
    new File([new Uint8Array([1, 2, 3])], "invoice.png", { type: "image/png" })
  );
  return formData;
}

function createTestDatabase() {
  const db = new Database(":memory:");
  db.exec(schemaSql);
  return db;
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("企业开票时税号留空也能提交成功", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      body: createValidFormData(),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.success, true);

    const row = db
      .prepare("SELECT tax_number, attachment_path FROM submissions WHERE id = ?")
      .get(payload.id);
    assert.equal(row.tax_number, null);
    assert.equal(fs.existsSync(row.attachment_path), true);
  });
});

test("缺少邮箱时提交失败", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  const formData = createValidFormData();
  formData.set("email", "");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.field, "email");
  });
});

test("附件超过 20MB 时提交失败", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  const formData = createValidFormData();
  formData.set(
    "attachment",
    new File([new Uint8Array(20 * 1024 * 1024 + 1)], "too-large.pdf", {
      type: "application/pdf",
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.field, "attachment");
  });
});

test("healthz 返回 ok", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("数据库写入失败时会删除刚写入的附件", async () => {
  const tempDir = createTempDirectory();
  const uploadsRoot = path.join(tempDir, "uploads");
  const failingDb = {
    prepare() {
      return {
        run() {
          throw new Error("db failed");
        },
      };
    },
  };

  await assert.rejects(
    () =>
      createSubmissionRecord({
        body: {
          invoiceType: "enterprise",
          invoiceTitle: "上海示例科技有限公司",
          taxNumber: "",
          email: "finance@example.com",
          contact: "",
          note: "",
        },
        file: {
          originalname: "invoice.png",
          mimetype: "image/png",
          size: 3,
          buffer: Buffer.from([1, 2, 3]),
        },
        db: failingDb,
        uploadsRoot,
        now: new Date("2026-06-29T12:00:00Z"),
        generateId: () => "cleanup-id",
      }),
    /db failed/
  );

  const relativePath = buildAttachmentRelativePath(
    "cleanup-id",
    "invoice.png",
    new Date("2026-06-29T12:00:00Z")
  );
  const attachmentPath = path.join(uploadsRoot, relativePath.replace(/^uploads[\\/]/, ""));
  assert.equal(fs.existsSync(attachmentPath), false);
});

test("上传类型不是 PNG/JPG/PDF 时提交失败", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
    upload: multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  });

  const formData = createValidFormData();
  formData.set("attachment", new File([new Uint8Array([1, 2, 3])], "bad.gif", { type: "image/gif" }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.field, "attachment");
  });
});
