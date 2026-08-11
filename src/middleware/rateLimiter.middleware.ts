import rateLimit from "express-rate-limit";

/**
 * Rate limiter specifically for the resume upload endpoint, since each file
 * uploaded triggers a real, paid LLM API call. Without this, a mistake or
 * misuse (accidental loop, someone hammering the button) can run up a large
 * bill with no friction.
 *
 * Limits: 20 upload *requests* per IP per 15 minutes. Note this limits
 * requests, not individual files within a request — a single request can
 * still contain up to 25 files (see upload.middleware.ts), so the effective
 * ceiling is up to 500 resumes per IP per 15 minutes, which is a reasonable
 * ceiling for a small internal HR team while still stopping runaway loops.
 * Tune via UPLOAD_RATE_LIMIT_MAX / UPLOAD_RATE_LIMIT_WINDOW_MINUTES if needed.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: (Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MINUTES) || 15) * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Too many upload requests from this location. Please wait a few minutes before uploading more resumes.",
  },
});
