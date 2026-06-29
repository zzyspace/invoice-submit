import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
]);

export const serverHost = process.env.INVOICE_SUBMIT_HOST || "127.0.0.1";
export const serverPort = Number(process.env.PORT || 8787);
export const dataRoot =
  process.env.INVOICE_SUBMIT_DATA_ROOT || path.join(projectRoot, ".data");
export const publicDir = path.join(projectRoot, "public");
export const dbFilePath = path.join(dataRoot, "data", "app.db");
export const uploadsRoot = path.join(dataRoot, "uploads");
export const dbInitSqlPath = path.join(projectRoot, "db", "init.sql");
export const adminUsername = process.env.INVOICE_ADMIN_USERNAME || "";
export const adminPassword = process.env.INVOICE_ADMIN_PASSWORD || "";
