import fs from "node:fs/promises";
import path from "node:path";

import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "./config.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SubmissionValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "SubmissionValidationError";
    this.field = field;
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSubmissionPayload(body) {
  return {
    invoiceType: normalizeString(body.invoiceType),
    invoiceTitle: normalizeString(body.invoiceTitle),
    taxNumber: normalizeString(body.taxNumber),
    email: normalizeString(body.email),
    contact: normalizeString(body.contact),
    note: normalizeString(body.note),
  };
}

export function validateSubmission(payload) {
  if (!["enterprise", "personal"].includes(payload.invoiceType)) {
    throw new SubmissionValidationError("请选择开票主体类型。", "invoiceType");
  }

  if (!payload.invoiceTitle) {
    throw new SubmissionValidationError("请填写发票抬头。", "invoiceTitle");
  }

  if (payload.invoiceTitle.length > 120) {
    throw new SubmissionValidationError("发票抬头长度不能超过 120 个字符。", "invoiceTitle");
  }

  if (payload.taxNumber.length > 64) {
    throw new SubmissionValidationError("税号长度不能超过 64 个字符。", "taxNumber");
  }

  if (!payload.email) {
    throw new SubmissionValidationError("请填写邮箱。", "email");
  }

  if (!EMAIL_PATTERN.test(payload.email)) {
    throw new SubmissionValidationError("请输入有效的邮箱地址。", "email");
  }

  if (payload.email.length > 160) {
    throw new SubmissionValidationError("邮箱长度不能超过 160 个字符。", "email");
  }

  if (payload.contact.length > 64) {
    throw new SubmissionValidationError("联系方式长度不能超过 64 个字符。", "contact");
  }

  if (payload.note.length > 500) {
    throw new SubmissionValidationError("备注长度不能超过 500 个字符。", "note");
  }

  return payload;
}

export function validateAttachment(file) {
  if (!file) {
    throw new SubmissionValidationError("请上传付款凭证。", "attachment");
  }

  if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
    throw new SubmissionValidationError("仅支持 PNG、JPG、PDF 文件。", "attachment");
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new SubmissionValidationError("附件大小不能超过 20MB。", "attachment");
  }

  return file;
}

export function sanitizeFilename(filename) {
  const cleaned = filename
    .normalize("NFKC")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return cleaned || "attachment";
}

export function buildAttachmentRelativePath(id, filename, now = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return path.join("uploads", year, month, `${id}-${sanitizeFilename(filename)}`);
}

export async function createSubmissionRecord({
  body,
  file,
  db,
  uploadsRoot,
  now = new Date(),
  generateId = () => crypto.randomUUID(),
}) {
  const submission = validateSubmission(normalizeSubmissionPayload(body));
  const attachment = validateAttachment(file);

  const id = generateId();
  const createdAt = now.toISOString();
  const relativeAttachmentPath = buildAttachmentRelativePath(id, attachment.originalname, now);
  const absoluteAttachmentPath = path.join(
    uploadsRoot,
    relativeAttachmentPath.replace(/^uploads[\\/]/, "")
  );

  await fs.mkdir(path.dirname(absoluteAttachmentPath), { recursive: true });
  await fs.writeFile(absoluteAttachmentPath, attachment.buffer);

  try {
    db.prepare(
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
    ).run(
      id,
      submission.invoiceType,
      submission.invoiceTitle,
      submission.taxNumber || null,
      submission.email,
      submission.contact || null,
      submission.note || null,
      absoluteAttachmentPath,
      attachment.originalname,
      attachment.mimetype,
      attachment.size,
      createdAt
    );
  } catch (error) {
    try {
      await fs.rm(absoluteAttachmentPath, { force: true });
    } catch {
      // Cleanup failure should not hide the original database error.
    }
    throw error;
  }

  return {
    id,
    createdAt,
    attachmentPath: absoluteAttachmentPath,
  };
}
