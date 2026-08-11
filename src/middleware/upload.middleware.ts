import multer from "multer";
import { Request } from "express";

const MAX_SIZE = Number(process.env.MAX_UPLOAD_SIZE_BYTES) || 5 * 1024 * 1024; // 5MB default

/**
 * In-memory storage: files are kept as Buffers in req.files rather than
 * written to disk, since we only need them transiently to extract text.
 */
const storage = multer.memoryStorage();

function pdfOnlyFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error(`Rejected file "${file.originalname}": only PDF files are accepted.`));
  }
}

export const uploadResumes = multer({
  storage,
  fileFilter: pdfOnlyFilter,
  limits: {
    fileSize: MAX_SIZE,
    files: 25, // cap batch size per upload request
  },
});
