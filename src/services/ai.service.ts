import axios from "axios";
import { AppError } from "../utils/AppError";
import { AiEvaluationResult, isValidAiEvaluationResult } from "../utils/types";
import { logger } from "../utils/logger";

/**
 * Generic system prompt instructing the LLM to act as a strict, unbiased
 * technical recruiter. Designed to:
 *  - Reward applied/demonstrated experience over keyword density
 *  - Actively guard against keyword-stuffing bias
 *  - Force strict, parseable JSON output with no prose wrapper
 */
const SYSTEM_PROMPT = `You are a senior technical recruiter with 15+ years of experience screening resumes for engineering and technical roles. You are strict, unbiased, and evidence-driven.

Your task: compare a candidate's resume text against a job description (JD) and produce a structured evaluation.

Rules you MUST follow:
1. Judge candidates on APPLIED, DEMONSTRATED experience (projects, roles, measurable outcomes) — not on how many keywords from the JD appear in the resume. A resume that lists a skill once but shows no evidence of using it should NOT outscore one with fewer keyword matches but clear applied depth.
2. Actively guard against "keyword stuffing" bias: if a resume appears to list many buzzwords/skills with no supporting context (projects, responsibilities, outcomes), treat that as a mild red flag rather than a strength.
3. Identify concrete matchedSkills (present AND evidenced in the resume) and missingSkills (required/important per the JD but absent or unevidenced).
4. Note redFlags such as unexplained employment gaps, inconsistent dates, vague/unverifiable claims, overqualification/underqualification mismatches, or job-hopping patterns. If none exist, redFlags should be the string "None identified".
5. overallScore is an integer from 0-100 reflecting how well the candidate fits THIS specific JD.
6. explainability must be a clear, concise paragraph (3-6 sentences) justifying the score in plain language a hiring manager could read directly.
7. candidateName should be your best extraction of the candidate's full name from the resume text. If it cannot be determined, use "Unknown Candidate".

OUTPUT FORMAT — CRITICAL:
Respond with ONLY a single valid JSON object. No markdown code fences, no preamble, no explanation outside the JSON, no trailing commentary. The JSON object must exactly match this shape:

{
  "candidateName": string,
  "overallScore": number,
  "matchedSkills": string[],
  "missingSkills": string[],
  "redFlags": string,
  "explainability": string
}`;

type LlmProvider = "anthropic" | "openai" | "gemini";

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

interface OpenAiResponse {
  choices: Array<{ message: { content: string } }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
}

/**
 * Abstract AI service. This function is provider-agnostic at the call-site:
 * evaluateResumeAgainstJob() never changes regardless of which provider is
 * configured. Provider selection happens entirely through env vars:
 *
 *   LLM_PROVIDER = "anthropic" | "openai" | "gemini"   (default: "anthropic")
 *   LLM_API_KEY  = your provider's API key
 *   LLM_MODEL    = model name for that provider
 *   LLM_API_URL  = optional override of the default endpoint for the chosen provider
 *
 * To add a new provider: add a case to callLlm() below that builds the
 * correct request and extracts the response text. Nothing else needs to change.
 */
export async function evaluateResumeAgainstJob(
  jobDescription: string,
  resumeText: string
): Promise<AiEvaluationResult> {
  const userPrompt = `JOB DESCRIPTION:\n${jobDescription}\n\n---\n\nRESUME TEXT:\n${resumeText}\n\n---\n\nReturn ONLY the JSON evaluation object as specified in the system prompt.`;

  logger.debug("Sending resume evaluation request to LLM", {
    provider: process.env.LLM_PROVIDER || "anthropic",
    model: process.env.LLM_MODEL,
    resumeTextLength: resumeText.length,
  });

  const rawText = await callLlm(SYSTEM_PROMPT, userPrompt);

  logger.debug("Raw LLM response received", { rawText });

  const parsed = safeParseJson(rawText);

  if (!isValidAiEvaluationResult(parsed)) {
    logger.error("LLM response failed schema validation", { parsed });
    throw new AppError(
      "LLM returned a response that did not match the expected evaluation schema.",
      502
    );
  }

  // Defensive clamp in case the model returns a value outside 0-100
  parsed.overallScore = Math.max(0, Math.min(100, Math.round(parsed.overallScore)));

  logger.info("Resume evaluation succeeded", {
    candidateName: parsed.candidateName,
    overallScore: parsed.overallScore,
  });

  return parsed;
}

/**
 * Dispatches to the correct provider-specific implementation based on
 * LLM_PROVIDER. Each branch builds that provider's request shape and
 * extracts plain text from that provider's response shape, so the rest
 * of the app never has to know which provider is active.
 */
async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const provider = (process.env.LLM_PROVIDER?.toLowerCase() || "anthropic") as LlmProvider;
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new AppError(
      "LLM_API_KEY is not configured on the server. Set it in your .env file.",
      500
    );
  }

  return withRetry(async () => {
    switch (provider) {
      case "anthropic":
        return await callAnthropic(systemPrompt, userPrompt, apiKey);
      case "openai":
        return await callOpenAi(systemPrompt, userPrompt, apiKey);
      case "gemini":
        return await callGemini(systemPrompt, userPrompt, apiKey);
      default:
        throw new AppError(
          `Unknown LLM_PROVIDER "${provider}". Expected "anthropic", "openai", or "gemini".`,
          500
        );
    }
  }, provider);
}

/** HTTP statuses worth retrying: transient overload/rate-limit, not real errors. */
const RETRYABLE_STATUSES = new Set([429, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Wraps a single LLM call with retry + exponential backoff for transient
 * failures (provider overload, rate limits, gateway timeouts). Non-retryable
 * errors (bad API key, invalid model, schema validation failures) fail immediately.
 */
async function withRetry(fn: () => Promise<string>, provider: string): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);

      if (!isRetryable || attempt === MAX_RETRIES) {
        break;
      }

      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1); // 1s, 2s, 4s
      logger.warn("LLM call failed with a retryable error, backing off", {
        provider,
        status,
        attempt,
        maxRetries: MAX_RETRIES,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw normalizeLlmError(lastErr, provider);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLlmError(err: unknown, provider: string): AppError {
  if (err instanceof AppError) return err;

  if (axios.isAxiosError(err)) {
    logger.error("LLM HTTP request failed", {
      provider,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    if (err.code === "ECONNABORTED") {
      return new AppError("LLM request timed out.", 504);
    }
    const status = err.response?.status;
    if (status === 503) {
      return new AppError(
        `${provider} is currently experiencing high demand. Retries were exhausted — please try uploading this resume again in a minute.`,
        503
      );
    }
    if (status === 429) {
      return new AppError(
        `${provider} rate limit reached. Retries were exhausted — please wait a moment and try again.`,
        429
      );
    }
    return new AppError(
      `LLM API error (${provider}): ${status ?? ""} ${JSON.stringify(
        err.response?.data ?? err.message
      )}`,
      502
    );
  }

  return err instanceof Error
    ? new AppError(err.message, 500)
    : new AppError("Unknown error calling LLM.", 500);
}

/** Anthropic Messages API — https://docs.claude.com/en/api/messages */
async function callAnthropic(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const apiUrl = process.env.LLM_API_URL || "https://api.anthropic.com/v1/messages";
  const model = process.env.LLM_MODEL || "claude-sonnet-4-6";

  const response = await axios.post<AnthropicResponse>(
    apiUrl,
    {
      model,
      max_tokens: 1500,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      timeout: 30000,
    }
  );

  const textBlock = response.data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new AppError("Anthropic response contained no text content.", 502);
  }
  return textBlock.text;
}

/** OpenAI Chat Completions API — https://platform.openai.com/docs/api-reference/chat */
async function callOpenAi(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const apiUrl = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.LLM_MODEL || "gpt-4o";

  const response = await axios.post<OpenAiResponse>(
    apiUrl,
    {
      model,
      max_tokens: 1500,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    }
  );

  const text = response.data.choices?.[0]?.message?.content;
  if (!text) {
    throw new AppError("OpenAI response contained no text content.", 502);
  }
  return text;
}

/**
 * Google Gemini API — https://ai.google.dev/api/generate-content
 * Notes vs Anthropic/OpenAI:
 *  - No dedicated system-role message; systemInstruction is a separate field.
 *  - API key is passed as a query param, not a header.
 *  - responseMimeType: "application/json" forces the model to emit strict
 *    JSON with no markdown fences or preamble — this avoids the most common
 *    failure mode (JSON wrapped in prose or code fences).
 *  - maxOutputTokens must be generous: reasoning-capable Gemini models (2.5+)
 *    spend part of the output budget on internal "thinking" tokens before
 *    the visible JSON, so a low cap can silently truncate the JSON output.
 */
async function callGemini(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const model = process.env.LLM_MODEL || "gemini-2.5-pro";
  const baseUrl =
    process.env.LLM_API_URL ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const apiUrl = `${baseUrl}?key=${apiKey}`;

  const response = await axios.post<GeminiResponse>(
    apiUrl,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        // Deterministic-leaning output: this is a scoring/extraction task,
        // not creative generation, so we want the same resume+JD pair to
        // produce a consistent score rather than drifting run to run.
        temperature: 0,
        // Gemini 2.5 models spend part of the token budget on internal
        // "thinking" before answering. Disabling it (budget 0) makes the
        // full maxOutputTokens available to the actual JSON answer, and
        // is unnecessary for this task anyway (structured extraction/scoring,
        // not multi-step reasoning).
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 45000,
    }
  );

  logger.debug("Gemini raw HTTP response", { data: response.data });

  const candidate = response.data.candidates?.[0];

  // Reasoning-capable Gemini models (2.5+) can return multiple parts, including
  // an internal "thought" part that also has a `text` field. Skip thought parts
  // and take the first genuine answer part, or the failure mode is picking up
  // the model's internal reasoning summary instead of the actual JSON answer.
  const text = candidate?.content?.parts?.find((p) => p.text && !p.thought)?.text;

  if (!text) {
    const finishReason = candidate?.finishReason;
    logger.error("Gemini returned no usable answer text", { candidate, finishReason });
    throw new AppError(
      finishReason === "MAX_TOKENS"
        ? "Gemini response was truncated (hit MAX_TOKENS) before producing output. Try increasing maxOutputTokens further."
        : "Gemini response contained no text content.",
      502
    );
  }
  return text;
}

/**
 * Safely parses JSON from an LLM response, tolerating common deviations:
 *  - Markdown code fences (```json ... ```) despite instructions not to use them
 *  - Leading/trailing prose wrapped around the JSON object
 * Logs the raw response on failure so the actual model output is visible
 * in server logs for debugging, rather than only a generic error.
 */
function safeParseJson(text: string): unknown {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: extract the outermost {...} block in case the model added
    // any stray prose before/after the JSON object.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through to error below
      }
    }

    logger.error("Failed to parse LLM response as JSON", { rawText: text });
    throw new AppError(
      "Failed to parse LLM response as JSON. Raw response could not be decoded.",
      502
    );
  }
}