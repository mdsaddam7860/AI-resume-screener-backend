import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { AppError } from "../utils/AppError";

/**
 * Centralized Express error-handling middleware.
 * Must be registered last, after all routes.
 * Normalizes AppError, Multer errors, and unexpected errors into a
 * consistent JSON error response shape.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Known, intentionally-thrown application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  // Multer-specific errors (file too large, too many files, etc.)
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      error: `Upload error: ${err.message}`,
    });
    return;
  }

  // File filter rejection (thrown as a plain Error from fileFilter callback)
  if (err instanceof Error && err.message.includes("only PDF files are accepted")) {
    res.status(400).json({ error: err.message });
    return;
  }

  // Fallback: unexpected/unhandled errors
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "An unexpected server error occurred.",
  });
}

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}
