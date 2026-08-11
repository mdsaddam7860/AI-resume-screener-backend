import { Router } from "express";
import { createJob, listJobs, getJob } from "../controllers/job.controller";
import { uploadResumes as uploadMiddleware } from "../middleware/upload.middleware";
import { uploadRateLimiter } from "../middleware/rateLimiter.middleware";
import { uploadResumes, getCandidatesForJob, exportCandidatesCsv } from "../controllers/candidate.controller";

const router = Router();

// Job CRUD (create/list/read)
router.post("/", createJob);
router.get("/", listJobs);
router.get("/:id", getJob);

// Resume upload + AI evaluation, scoped to a job. Rate-limited since each
// file triggers a paid LLM call.
router.post("/:id/upload", uploadRateLimiter, uploadMiddleware.array("resumes"), uploadResumes);

// Ranked candidates for a job
router.get("/:id/candidates", getCandidatesForJob);

// CSV export of ranked candidates for a job
router.get("/:id/candidates/export", exportCandidatesCsv);

export default router;
