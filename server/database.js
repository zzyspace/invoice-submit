import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export function createDatabase({ dbFilePath, dbInitSqlPath }) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  const schema = fs.readFileSync(dbInitSqlPath, "utf8");
  db.exec(schema);
  return db;
}
