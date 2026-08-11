import fs from "fs";
import path from "path";
import winston from "winston";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Centralized Winston logger.
 * - Console output: human-readable, colorized, for local dev.
 * - File output: JSON lines in logs/app.log and logs/error.log for later inspection
 *   (e.g. grepping the raw LLM response that failed to parse).
 *
 * Usage: import { logger } from "../utils/logger"; logger.info("msg", { meta });
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/app.log" }),
  ],
});

// Also log to console in a readable format (always on, since this is an
// internal dev tool and console visibility while debugging is the point).
logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: "HH:mm:ss" }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : "";
        return `${timestamp} [${level}] ${message}${metaStr}`;
      })
    ),
  })
);