/*
  Warnings:

  - A unique constraint covering the columns `[jobId,resumeFileName]` on the table `Candidate` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Candidate_jobId_resumeFileName_key" ON "Candidate"("jobId", "resumeFileName");
