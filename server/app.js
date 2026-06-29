import path from "node:path";

import express from "express";
import multer from "multer";

import {
  MAX_ATTACHMENT_BYTES,
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
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.get("/index.html", sendNotFound);
  app.use(express.static(staticDir, { index: false }));

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
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
