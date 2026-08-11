import { Request, Response } from "express";
import { Job } from "@prisma/client";
import prisma from "../utils/prismaClient";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/AppError";

/**
 * POST /api/jobs
 * Creates a new job posting.
 */
export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const { title, description } = req.body as { title?: string; description?: string };

  if (!title || !title.trim()) {
    throw new AppError("Job title is required.", 400);
  }
  if (!description || !description.trim()) {
    throw new AppError("Job description is required.", 400);
  }

  const job = await prisma.job.create({
    data: { title: title.trim(), description: description.trim() },
  });

  res.status(201).json(job);
});

/**
 * GET /api/jobs
 * Lists all jobs, newest first, with candidate counts.
 */
export const listJobs = asyncHandler(async (_req: Request, res: Response) => {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { candidates: true } } },
  });

  res.json(
    jobs.map((j: Job & { _count: { candidates: number } }) => ({
      id: j.id,
      title: j.title,
      description: j.description,
      createdAt: j.createdAt,
      candidateCount: j._count.candidates,
    }))
  );
});

/**
 * GET /api/jobs/:id
 * Fetch a single job by id (used by frontend to show JD on details page).
 */
export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const job = await prisma.job.findUnique({ where: { id } });

  if (!job) {
    throw new AppError(`Job with id "${id}" not found.`, 404);
  }

  res.json(job);
});
