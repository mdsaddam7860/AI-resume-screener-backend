// pdf-parse ships without types that play perfectly with strict esModuleInterop,
// so we import it via require to avoid default-export friction while still
// keeping the rest of the file strictly typed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
// const pdfParse = require("pdf-parse");
import pdfParse from "pdf-parse";
import { AppError } from "./AppError";

/**
 * Extracts raw text from a PDF file buffer.
 * Throws an AppError (400) if the buffer cannot be parsed as a valid PDF.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    if (!result.text || result.text.trim().length === 0) {
      throw new AppError(
        "PDF parsed successfully but contained no extractable text (possibly a scanned image PDF).",
        400
      );
    }
    return result.text;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : "unknown error"}`,
      400
    );
  }
}

/**
 * Cleans raw extracted PDF text to reduce noise and save LLM tokens:
 * - Collapses repeated whitespace/newlines
 * - Strips non-printable / control characters
 * - Removes common PDF extraction artifacts (page numbers, excessive dashes)
 * - Trims to a safe max length to protect against runaway token usage
 */
export function cleanResumeText(rawText: string, maxLength = 12000): string {
  let text = rawText
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ") // strip control chars, keep \n \t
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ") // collapse repeated spaces/tabs
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .replace(/^\s*\d+\s*$/gm, "") // strip lines that are just page numbers
    .replace(/-{4,}/g, "") // strip long dash separators
    .trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + "\n[TRUNCATED FOR LENGTH]";
  }

  return text;
}

/**
 * Best-effort extraction of a candidate's display name from the top of a resume.
 * This is a heuristic fallback used before the AI's own name extraction (if any);
 * primarily useful for populating resumeFileName-derived defaults.
 */
export function guessNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(resume|cv)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ") || "Unknown Candidate";
}
