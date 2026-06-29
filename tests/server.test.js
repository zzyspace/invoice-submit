import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import Database from "better-sqlite3";
import multer from "multer";

import { createApp } from "../server/app.js";
import { createDatabase } from "../server/database.js";
import { buildAttachmentRelativePath, createSubmissionRecord } from "../server/submissions.js";

const schemaSql = `
CREATE TABLE IF NOT EXISTS submissions (
  submit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  invoice_type TEXT NOT NULL,
  invoice_title TEXT NOT NULL,
  tax_number TEXT,
  email TEXT NOT NULL,
  contact TEXT,
  note TEXT,
  store_key TEXT,
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
  formData.set("storeKey", "fuzzy");
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

function createAdminAuthHeaders(username = "admin", password = "secret-pass") {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
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
      .prepare("SELECT submit_id, tax_number, store_key, attachment_path FROM submissions WHERE id = ?")
      .get(payload.id);
    assert.equal(row.submit_id, 1);
    assert.equal(row.tax_number, null);
    assert.equal(row.store_key, "fuzzy");
    assert.equal(fs.existsSync(row.attachment_path), true);
  });
});

test("只有门店路径返回开票页面", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  await withServer(app, async (baseUrl) => {
    for (const route of ["/fuzzy", "/fuzzy_qz", "/peanut"]) {
      const validResponse = await fetch(`${baseUrl}${route}`);
      assert.equal(validResponse.status, 200);
      assert.match(await validResponse.text(), /name="storeKey"/);
    }

    const rootResponse = await fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 404);

    const indexResponse = await fetch(`${baseUrl}/index.html`);
    assert.equal(indexResponse.status, 404);
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

test("门店标识无效时提交失败", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
  });

  const formData = createValidFormData();
  formData.set("storeKey", "store-alpha");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.field, "storeKey");
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
          storeKey: "fuzzy",
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

test("启动时会迁移旧 submissions 表并补齐 submit_id、store_key 列", () => {
  const tempDir = createTempDirectory();
  const dbFilePath = path.join(tempDir, "app.db");
  const dbInitSqlPath = path.join(tempDir, "init.sql");

  fs.writeFileSync(dbInitSqlPath, schemaSql);

  const seedDb = new Database(dbFilePath);
  seedDb.exec(`
CREATE TABLE submissions (
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
  `);
  seedDb
    .prepare(
      `INSERT INTO submissions (
        id,
        invoice_type,
        invoice_title,
        tax_number,
        email,
        contact,
        note,
        attachment_path,
        attachment_name,
        attachment_content_type,
        attachment_size_bytes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "legacy-submission",
      "enterprise",
      "旧版记录",
      null,
      "legacy@example.com",
      null,
      null,
      "/tmp/legacy.png",
      "legacy.png",
      "image/png",
      3,
      "2026-06-30T00:00:00.000Z"
    );
  seedDb.close();

  const db = createDatabase({ dbFilePath, dbInitSqlPath });

  try {
    const columns = db.prepare("PRAGMA table_info(submissions)").all();
    const submitIdColumn = columns.find((column) => column.name === "submit_id");
    assert.equal(submitIdColumn?.pk, 1);
    assert.equal(columns.some((column) => column.name === "store_key"), true);
    const row = db
      .prepare("SELECT submit_id, id, store_key FROM submissions WHERE id = ?")
      .get("legacy-submission");
    assert.equal(row.submit_id, 1);
    assert.equal(row.id, "legacy-submission");
    assert.equal(row.store_key, null);
  } finally {
    db.close();
  }
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

test("管理员接口未配置账号密码时返回 503", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
    adminCredentials: { username: "", password: "" },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/submissions`);
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.match(payload.error.message, /尚未配置账号密码/);
  });
});

test("管理员接口需要 Basic Auth", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const app = createApp({
    db,
    uploadDirectory: path.join(tempDir, "uploads"),
    staticDir: path.join(process.cwd(), "public"),
    adminCredentials: { username: "admin", password: "secret-pass" },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/submissions`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Basic realm="Invoice Submit Admin", charset="UTF-8"');
  });
});

test("管理员可以分页查看提交记录", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const uploadsRoot = path.join(tempDir, "uploads");
  const app = createApp({
    db,
    uploadDirectory: uploadsRoot,
    staticDir: path.join(process.cwd(), "public"),
    adminCredentials: { username: "admin", password: "secret-pass" },
  });

  await createSubmissionRecord({
    body: {
      invoiceType: "enterprise",
      invoiceTitle: "上海示例科技有限公司",
      taxNumber: "91310000MA000001",
      email: "finance@example.com",
      contact: "13800000000",
      note: "首单",
      storeKey: "fuzzy",
    },
    file: {
      originalname: "invoice-a.png",
      mimetype: "image/png",
      size: 3,
      buffer: Buffer.from([1, 2, 3]),
    },
    db,
    uploadsRoot,
    now: new Date("2026-06-30T01:00:00Z"),
    generateId: () => "submission-a",
  });

  await createSubmissionRecord({
    body: {
      invoiceType: "personal",
      invoiceTitle: "王小明",
      taxNumber: "",
      email: "wang@example.com",
      contact: "13900000000",
      note: "第二单",
      storeKey: "peanut",
    },
    file: {
      originalname: "invoice-b.pdf",
      mimetype: "application/pdf",
      size: 4,
      buffer: Buffer.from([4, 5, 6, 7]),
    },
    db,
    uploadsRoot,
    now: new Date("2026-06-30T02:00:00Z"),
    generateId: () => "submission-b",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/admin/submissions?storeKey=peanut&search=%E7%8E%8B&limit=20&offset=0`,
      {
        headers: createAdminAuthHeaders(),
      }
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.total, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].submit_id, 2);
    assert.equal(payload.items[0].id, "submission-b");
    assert.equal(payload.items[0].attachment_name, "invoice-b.pdf");
  });
});

test("管理员可以查看提交附件", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const uploadsRoot = path.join(tempDir, "uploads");
  const app = createApp({
    db,
    uploadDirectory: uploadsRoot,
    staticDir: path.join(process.cwd(), "public"),
    adminCredentials: { username: "admin", password: "secret-pass" },
  });

  await createSubmissionRecord({
    body: {
      invoiceType: "enterprise",
      invoiceTitle: "上海示例科技有限公司",
      taxNumber: "",
      email: "finance@example.com",
      contact: "",
      note: "",
      storeKey: "fuzzy",
    },
    file: {
      originalname: "invoice-preview.png",
      mimetype: "image/png",
      size: 3,
      buffer: Buffer.from([8, 9, 10]),
    },
    db,
    uploadsRoot,
    now: new Date("2026-06-30T03:00:00Z"),
    generateId: () => "submission-preview",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/submissions/submission-preview/attachment`, {
      headers: createAdminAuthHeaders(),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("content-disposition"), /invoice-preview\.png/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([8, 9, 10]));
  });
});

test("管理员可以删除提交记录并清理附件", async () => {
  const db = createTestDatabase();
  const tempDir = createTempDirectory();
  const uploadsRoot = path.join(tempDir, "uploads");
  const app = createApp({
    db,
    uploadDirectory: uploadsRoot,
    staticDir: path.join(process.cwd(), "public"),
    adminCredentials: { username: "admin", password: "secret-pass" },
  });

  const created = await createSubmissionRecord({
    body: {
      invoiceType: "enterprise",
      invoiceTitle: "待删除记录",
      taxNumber: "",
      email: "delete@example.com",
      contact: "13600000000",
      note: "删除测试",
      storeKey: "fuzzy",
    },
    file: {
      originalname: "delete-me.png",
      mimetype: "image/png",
      size: 3,
      buffer: Buffer.from([11, 12, 13]),
    },
    db,
    uploadsRoot,
    now: new Date("2026-06-30T04:00:00Z"),
    generateId: () => "submission-delete",
  });

  assert.equal(fs.existsSync(created.attachmentPath), true);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/submissions/submission-delete`, {
      method: "DELETE",
      headers: createAdminAuthHeaders(),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.id, "submission-delete");

    const remaining = db.prepare("SELECT id FROM submissions WHERE id = ?").get("submission-delete");
    assert.equal(remaining, undefined);
    assert.equal(fs.existsSync(created.attachmentPath), false);
  });
});
