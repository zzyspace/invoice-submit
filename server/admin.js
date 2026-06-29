import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";

import { ALLOWED_STORE_KEYS } from "./submissions.js";

function hasValue(value) {
  return typeof value === "string" && value.length > 0;
}

function secureCompare(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthHeader(header) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function setNoStore(response) {
  response.set("Cache-Control", "no-store");
}

function sendAdminError(request, response, statusCode, message, extraHeaders = {}) {
  setNoStore(response);
  response.set(extraHeaders);

  if (request.path.startsWith("/api/")) {
    response.status(statusCode).json({
      success: false,
      error: {
        message,
      },
    });
    return;
  }

  response.status(statusCode).type("text/plain; charset=utf-8").send(message);
}

export function createAdminAuthMiddleware({
  username,
  password,
  realm = "Invoice Submit Admin",
} = {}) {
  const isConfigured = hasValue(username) && hasValue(password);

  return (request, response, next) => {
    if (!isConfigured) {
      sendAdminError(request, response, 503, "管理员后台尚未配置账号密码。");
      return;
    }

    const credentials = parseBasicAuthHeader(request.headers.authorization);

    if (
      !credentials ||
      !secureCompare(credentials.username, username) ||
      !secureCompare(credentials.password, password)
    ) {
      sendAdminError(request, response, 401, "需要管理员身份验证。", {
        "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      });
      return;
    }

    setNoStore(response);
    next();
  };
}

function escapeLikePattern(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeSearch(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeAdminListQuery(query) {
  const search = normalizeSearch(query.search);
  const requestedStoreKey = normalizeSearch(query.storeKey ?? query.store_key);
  const storeKey = requestedStoreKey === "all" ? "" : requestedStoreKey;

  if (storeKey && !ALLOWED_STORE_KEYS.has(storeKey)) {
    throw new Error("invalid-store-key");
  }

  const parsedLimit = Number.parseInt(String(query.limit ?? "50"), 10);
  const parsedOffset = Number.parseInt(String(query.offset ?? "0"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  return {
    search,
    storeKey,
    limit,
    offset,
  };
}

function buildListWhereClause({ search, storeKey }) {
  const clauses = [];
  const params = {};

  if (storeKey) {
    clauses.push("store_key = @storeKey");
    params.storeKey = storeKey;
  }

  if (search) {
    clauses.push(
      `(
        id LIKE @search ESCAPE '\\'
        OR invoice_title LIKE @search ESCAPE '\\'
        OR email LIKE @search ESCAPE '\\'
        OR IFNULL(contact, '') LIKE @search ESCAPE '\\'
        OR IFNULL(note, '') LIKE @search ESCAPE '\\'
        OR IFNULL(tax_number, '') LIKE @search ESCAPE '\\'
      )`
    );
    params.search = `%${escapeLikePattern(search)}%`;
  }

  return {
    params,
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

export function listSubmissionsForAdmin(db, query) {
  const normalizedQuery = normalizeAdminListQuery(query);
  const { whereSql, params } = buildListWhereClause(normalizedQuery);
  const items = db
    .prepare(
      `SELECT
        id,
        invoice_type,
        invoice_title,
        tax_number,
        email,
        contact,
        note,
        store_key,
        attachment_name,
        attachment_content_type,
        attachment_size_bytes,
        created_at
      FROM submissions
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit OFFSET @offset`
    )
    .all({
      ...params,
      limit: normalizedQuery.limit,
      offset: normalizedQuery.offset,
    });

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM submissions ${whereSql}`)
    .get(params).count;

  return {
    total,
    limit: normalizedQuery.limit,
    offset: normalizedQuery.offset,
    items,
  };
}

export function getSubmissionAttachment(db, submissionId) {
  const record = db
    .prepare(
      `SELECT
        id,
        attachment_path,
        attachment_name,
        attachment_content_type
      FROM submissions
      WHERE id = ?`
    )
    .get(submissionId);

  if (!record || !hasValue(record.attachment_path) || !fs.existsSync(record.attachment_path)) {
    return null;
  }

  return record;
}

export async function deleteSubmissionForAdmin(db, submissionId) {
  const existing = db
    .prepare(
      `SELECT
        id,
        attachment_path
      FROM submissions
      WHERE id = ?`
    )
    .get(submissionId);

  if (!existing) {
    return null;
  }

  db.prepare("DELETE FROM submissions WHERE id = ?").run(submissionId);

  if (hasValue(existing.attachment_path)) {
    try {
      await fsPromises.rm(existing.attachment_path, { force: true });
    } catch (error) {
      // Database deletion is the source of truth. Attachment cleanup is best-effort.
      console.warn(`Failed to remove attachment for submission ${submissionId}:`, error);
    }
  }

  return {
    id: existing.id,
  };
}
