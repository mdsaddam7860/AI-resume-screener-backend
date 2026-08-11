import prisma from "../utils/prismaClient";
import { extractTextFromPdf, cleanResumeText, guessNameFromFileName } from "../utils/pdfParser";
import { evaluateResumeAgainstJob } from "./ai.service";
import { CandidateDto } from "../utils/types";
import { Candidate } from "@prisma/client";

export interface ProcessedResumeOutcome {
  fileName: string;
  success: boolean;
  candidate?: CandidateDto;
  error?: string;
}

/**
 * Processes a single uploaded resume file end-to-end:
 * parse PDF -> clean text -> AI evaluation -> persist to DB.
 * Isolated per-file error handling so one bad PDF in a batch
 * doesn't fail the entire upload.
 */
export async function processResumeFile(
  jobId: string,
  jobDescription: string,
  fileBuffer: Buffer,
  originalFileName: string
): Promise<ProcessedResumeOutcome> {
  try {
    const rawText = await extractTextFromPdf(fileBuffer);
    const cleanedText = cleanResumeText(rawText);

    const evaluation = await evaluateResumeAgainstJob(jobDescription, cleanedText);

    const candidateName =
      evaluation.candidateName && evaluation.candidateName !== "Unknown Candidate"
        ? evaluation.candidateName
        : guessNameFromFileName(originalFileName);

    const created = await prisma.candidate.upsert({
      where: {
        jobId_resumeFileName: {
          jobId,
          resumeFileName: originalFileName,
        },
      },
      update: {
        name: candidateName,
        overallScore: evaluation.overallScore,
        matchedSkills: JSON.stringify(evaluation.matchedSkills),
        missingSkills: JSON.stringify(evaluation.missingSkills),
        redFlags: evaluation.redFlags,
        explainability: evaluation.explainability,
      },
      create: {
        jobId,
        name: candidateName,
        resumeFileName: originalFileName,
        overallScore: evaluation.overallScore,
        matchedSkills: JSON.stringify(evaluation.matchedSkills),
        missingSkills: JSON.stringify(evaluation.missingSkills),
        redFlags: evaluation.redFlags,
        explainability: evaluation.explainability,
      },
    });

    return {
      fileName: originalFileName,
      success: true,
      candidate: toCandidateDto(created),
    };
  } catch (err) {
    return {
      fileName: originalFileName,
      success: false,
      error: err instanceof Error ? err.message : "Unknown error during processing.",
    };
  }
}

/** Converts a raw Prisma Candidate row (with JSON-string fields) into the frontend-facing DTO shape. */
export function toCandidateDto(candidate: Candidate): CandidateDto {
  return {
    id: candidate.id,
    jobId: candidate.jobId,
    name: candidate.name,
    resumeFileName: candidate.resumeFileName,
    overallScore: candidate.overallScore,
    matchedSkills: safeJsonArray(candidate.matchedSkills),
    missingSkills: safeJsonArray(candidate.missingSkills),
    redFlags: candidate.redFlags,
    explainability: candidate.explainability,
    createdAt: candidate.createdAt.toISOString(),
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}