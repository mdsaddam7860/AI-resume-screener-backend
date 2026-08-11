import { Request, Response } from "express";
import prisma from "../utils/prismaClient";
import { AppError, asyncHandler } from "../utils/AppError";
import { processResumeFile, toCandidateDto } from "../services/resume.service";

/**
 * POST /api/jobs/:id/upload
 * Accepts multiple PDF resumes (multipart/form-data, field name "resumes"),
 * parses + evaluates each against the job's description, and persists results.
 *
 * Each file is processed independently: a failure on one resume (bad parse,
 * malformed AI response, etc.) does not abort the rest of the batch. The
 * response reports per-file success/failure so the UI can surface partial errors.
 */
export const uploadResumes = asyncHandler(async (req: Request, res: Response) => {
  const { id: jobId } = req.params;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError(`Job with id "${jobId}" not found.`, 404);
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    throw new AppError('No files uploaded. Use form field name "resumes".', 400);
  }

  // Process sequentially to avoid slamming the LLM API with a burst of
  // concurrent requests (and to keep rate-limit behavior predictable).
  // For higher throughput, this could be changed to a bounded parallel pool.
  const results = [];
  for (const file of files) {
    const outcome = await processResumeFile(jobId, job.description, file.buffer, file.originalname);
    results.push(outcome);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  res.status(207).json({
    summary: { total: results.length, succeeded, failed },
    results,
  });
});

/**
 * GET /api/jobs/:id/candidates
 * Fetch all candidates for a job, ranked by overallScore descending.
 */
export const getCandidatesForJob = asyncHandler(async (req: Request, res: Response) => {
  const { id: jobId } = req.params;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError(`Job with id "${jobId}" not found.`, 404);
  }

  const candidates = await prisma.candidate.findMany({
    where: { jobId },
    orderBy: { overallScore: "desc" },
  });

  res.json(candidates.map(toCandidateDto));
});

/**
 * GET /api/jobs/:id/candidates/export
 * Downloads the ranked candidate list for a job as a CSV file, for sharing
 * with hiring managers who don't have access to the tool itself.
 */
export const exportCandidatesCsv = asyncHandler(async (req: Request, res: Response) => {
  const { id: jobId } = req.params;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError(`Job with id "${jobId}" not found.`, 404);
  }

  const candidates = await prisma.candidate.findMany({
    where: { jobId },
    orderBy: { overallScore: "desc" },
  });

  const dtos = candidates.map(toCandidateDto);
  const csv = buildCandidatesCsv(dtos);

  const safeJobTitle = job.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="candidates_${safeJobTitle || jobId}.csv"`
  );
  res.send(csv);
});

/**
 * Builds a CSV string from candidate DTOs. Fields containing commas, quotes,
 * or newlines (e.g. explainability paragraphs) are quoted and escaped per
 * standard CSV rules so the file opens correctly in Excel/Sheets.
 */
function buildCandidatesCsv(candidates: ReturnType<typeof toCandidateDto>[]): string {
  const headers = [
    "Rank",
    "Name",
    "Resume File",
    "Score",
    "Matched Skills",
    "Missing Skills",
    "Red Flags",
    "Explainability",
  ];

  const rows = candidates.map((c, idx) => [
    String(idx + 1),
    c.name,
    c.resumeFileName,
    String(c.overallScore),
    c.matchedSkills.join("; "),
    c.missingSkills.join("; "),
    c.redFlags,
    c.explainability,
  ]);

  const escapeCell = (cell: string): string => {
    if (/[",\n]/.test(cell)) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));
  return lines.join("\r\n");
}
