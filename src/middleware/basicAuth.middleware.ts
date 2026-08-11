import { Request, Response, NextFunction } from "express";

/**
 * Simple shared-credential HTTP Basic Auth for the whole API.
 * Appropriate for an internal tool behind a single username/password shared
 * by the HR team — not meant to replace real per-user auth/SSO, but closes
 * the "anyone with the URL can use it and burn the LLM budget" gap.
 *
 * Configure via env vars:
 *   BASIC_AUTH_USER
 *   BASIC_AUTH_PASSWORD
 *
 * If either is unset, auth is skipped entirely (useful for local dev) —
 * a warning is logged once at startup so this is never silently insecure
 * in an environment where you meant to set it.
 */
export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  // Auth disabled (no credentials configured) - typically local dev only.
  if (!expectedUser || !expectedPassword) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="AI Resume Screener"');
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  const separatorIndex = decoded.indexOf(":");
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (user === expectedUser && password === expectedPassword) {
    next();
    return;
  }

  res.set("WWW-Authenticate", 'Basic realm="AI Resume Screener"');
  res.status(401).json({ error: "Invalid credentials." });
}
