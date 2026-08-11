/**
 * Strongly typed shape of the JSON object the LLM must return
 * when evaluating a resume against a job description.
 */
export interface AiEvaluationResult {
  candidateName: string;
  overallScore: number; // 0-100
  matchedSkills: string[];
  missingSkills: string[];
  redFlags: string; // short paragraph, "None" if none found
  explainability: string; // paragraph explaining the reasoning behind the score
}

/**
 * Type guard that validates an unknown parsed JSON value actually
 * conforms to AiEvaluationResult before we trust it and write to the DB.
 */
export function isValidAiEvaluationResult(
  value: unknown
): value is AiEvaluationResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  return (
    typeof v.candidateName === "string" &&
    typeof v.overallScore === "number" &&
    v.overallScore >= 0 &&
    v.overallScore <= 100 &&
    Array.isArray(v.matchedSkills) &&
    v.matchedSkills.every((s) => typeof s === "string") &&
    Array.isArray(v.missingSkills) &&
    v.missingSkills.every((s) => typeof s === "string") &&
    typeof v.redFlags === "string" &&
    typeof v.explainability === "string"
  );
}

/** Shape of a Candidate record as sent to the frontend (DB fields are JSON strings, this is the parsed version). */
export interface CandidateDto {
  id: string;
  jobId: string;
  name: string;
  resumeFileName: string;
  overallScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  redFlags: string;
  explainability: string;
  createdAt: string;
}
