import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function ensureSubmissionColumns(db) {
  const existingColumns = new Set(
    db.prepare("PRAGMA table_info(submissions)").all().map((column) => column.name)
  );

  if (!existingColumns.has("store_key")) {
    db.exec("ALTER TABLE submissions ADD COLUMN store_key TEXT");
  }
}

export function createDatabase({ dbFilePath, dbInitSqlPath }) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  const schema = fs.readFileSync(dbInitSqlPath, "utf8");
  db.exec(schema);
  ensureSubmissionColumns(db);
  return db;
}
