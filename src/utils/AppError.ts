/**
 * Custom application error class.
 * Allows controllers to throw errors with an explicit HTTP status code,
 * which the centralized error handler middleware will respect.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Wraps an async Express route handler so that any rejected promise
 * is automatically forwarded to next(), avoiding repetitive try/catch
 * blocks in every controller.
 */
import { Request, Response, NextFunction, RequestHandler } from "express";

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
