import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function getSubmissionColumns(db) {
  return db.prepare("PRAGMA table_info(submissions)").all();
}

function rebuildSubmissionsTable(db, schema, existingColumns) {
  const copyStoreKeyExpression = existingColumns.has("store_key") ? "store_key" : "NULL";

  db.transaction(() => {
    db.exec("DROP INDEX IF EXISTS idx_submissions_created_at");
    db.exec("DROP INDEX IF EXISTS idx_submissions_email");
    db.exec("ALTER TABLE submissions RENAME TO submissions_legacy");
    db.exec(schema);
    db.prepare(
      `INSERT INTO submissions (
        id,
        invoice_type,
        invoice_title,
        tax_number,
        email,
        contact,
        note,
        store_key,
        attachment_path,
        attachment_name,
        attachment_content_type,
        attachment_size_bytes,
        created_at
      )
      SELECT
        id,
        invoice_type,
        invoice_title,
        tax_number,
        email,
        contact,
        note,
        ${copyStoreKeyExpression},
        attachment_path,
        attachment_name,
        attachment_content_type,
        attachment_size_bytes,
        created_at
      FROM submissions_legacy`
    ).run();
    db.exec("DROP TABLE submissions_legacy");
  })();
}

function ensureSubmissionSchema(db, schema) {
  const columns = getSubmissionColumns(db);
  const existingColumns = new Set(columns.map((column) => column.name));
  const submitIdColumn = columns.find((column) => column.name === "submit_id");

  if (!submitIdColumn || submitIdColumn.type.toUpperCase() !== "INTEGER" || submitIdColumn.pk !== 1) {
    rebuildSubmissionsTable(db, schema, existingColumns);
    return;
  }

  if (!existingColumns.has("store_key")) {
    db.exec("ALTER TABLE submissions ADD COLUMN store_key TEXT");
  }
}

export function createDatabase({ dbFilePath, dbInitSqlPath }) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  const schema = fs.readFileSync(dbInitSqlPath, "utf8");
  db.exec(schema);
  ensureSubmissionSchema(db, schema);
  return db;
}
