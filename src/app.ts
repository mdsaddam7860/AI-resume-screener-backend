import express, { Application } from "express";
import cors from "cors";
import jobRoutes from "./routes/job.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
// import { basicAuth } from "./middleware/basicAuth.middleware";
import { logger } from "./utils/logger";

export function createApp(): Application {
  const app = express();

  // Restrict CORS to the configured frontend origin in production; falls back
  // to allowing all origins if unset (convenient for local dev, but should
  // always be set once deployed).
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin) {
    logger.warn(
      "CORS_ORIGIN is not set - allowing requests from any origin. Set CORS_ORIGIN in production."
    );
  }
  app.use(cors({ origin: corsOrigin || true }));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health check is intentionally excluded from auth so uptime monitors work.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  if (!process.env.BASIC_AUTH_USER || !process.env.BASIC_AUTH_PASSWORD) {
    logger.warn(
      "BASIC_AUTH_USER/BASIC_AUTH_PASSWORD are not set - the API is unauthenticated. Set both in production."
    );
  }
  // app.use(basicAuth);

  // Feature routes
  app.use("/api/jobs", jobRoutes);

  // 404 + centralized error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
