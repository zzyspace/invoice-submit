import path from "node:path";

import express from "express";
import multer from "multer";

import {
  createAdminAuthMiddleware,
  deleteSubmissionForAdmin,
  getSubmissionAttachment,
  listSubmissionsForAdmin,
} from "./admin.js";
import {
  MAX_ATTACHMENT_BYTES,
  adminPassword,
  adminUsername,
  dbFilePath,
  dbInitSqlPath,
  publicDir,
  uploadsRoot,
} from "./config.js";
import { createDatabase } from "./database.js";
import {
  ALLOWED_STORE_KEYS,
  SubmissionValidationError,
  createSubmissionRecord,
} from "./submissions.js";

const storeRoutes = Array.from(ALLOWED_STORE_KEYS, (storeKey) => `/${storeKey}`);

function sendNotFound(_request, response) {
  response.status(404).type("text/plain").send("Not found");
}

function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES,
      files: 1,
    },
  });
}

export function createApp({
  db = createDatabase({ dbFilePath, dbInitSqlPath }),
  upload = createUploadMiddleware(),
  staticDir = publicDir,
  uploadDirectory = uploadsRoot,
  adminCredentials = { username: adminUsername, password: adminPassword },
} = {}) {
  const app = express();
  const adminAuth = createAdminAuthMiddleware(adminCredentials);

  app.disable("x-powered-by");
  app.get("/index.html", sendNotFound);
  app.get("/admin.html", sendNotFound);
  app.use(express.static(staticDir, { index: false }));

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get(["/admin", "/admin/"], adminAuth, (_request, response) => {
    response.sendFile(path.join(staticDir, "admin.html"));
  });

  app.get("/api/admin/submissions", adminAuth, (request, response, next) => {
    try {
      const result = listSubmissionsForAdmin(db, request.query);
      response.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/submissions/:id/attachment", adminAuth, (request, response) => {
    const attachment = getSubmissionAttachment(db, request.params.id);

    if (!attachment) {
      response.status(404).json({
        success: false,
        error: {
          message: "附件不存在或已被删除。",
        },
      });
      return;
    }

    response.type(attachment.attachment_content_type);
    response.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(attachment.attachment_name)}`
    );
    response.sendFile(attachment.attachment_path);
  });

  app.delete("/api/admin/submissions/:id", adminAuth, async (request, response, next) => {
    try {
      const deleted = await deleteSubmissionForAdmin(db, request.params.id);

      if (!deleted) {
        response.status(404).json({
          success: false,
          error: {
            message: "提交记录不存在或已被删除。",
          },
        });
        return;
      }

      response.status(200).json({
        success: true,
        id: deleted.id,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/submissions", (request, response, next) => {
    upload.single("attachment")(request, response, (error) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  });

  app.post("/api/submissions", async (request, response, next) => {
    try {
      const submission = await createSubmissionRecord({
        body: request.body,
        file: request.file,
        db,
        uploadsRoot: uploadDirectory,
      });

      response.status(201).json({
        success: true,
        id: submission.id,
        createdAt: submission.createdAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(storeRoutes, (_request, response) => {
    response.sendFile(path.join(staticDir, "index.html"));
  });

  app.use(sendNotFound);

  app.use((error, _request, response, _next) => {
    if (error instanceof SubmissionValidationError) {
      response.status(400).json({
        success: false,
        error: {
          field: error.field,
          message: error.message,
        },
      });
      return;
    }

    if (error?.code === "LIMIT_FILE_SIZE") {
      response.status(400).json({
        success: false,
        error: {
          field: "attachment",
          message: "附件大小不能超过 20MB。",
        },
      });
      return;
    }

    if (error?.message === "invalid-store-key") {
      response.status(400).json({
        success: false,
        error: {
          field: "storeKey",
          message: "门店筛选参数无效。",
        },
      });
      return;
    }

    console.error("Unexpected submission error:", error);
    response.status(500).json({
      success: false,
      error: {
        message: "提交失败，请稍后重试。",
      },
    });
  });

  return app;
}
