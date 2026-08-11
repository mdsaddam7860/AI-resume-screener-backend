import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma Client instance.
 * Prevents exhausting the SQLite connection pool via hot-reload in dev.
 */
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export default prisma;
