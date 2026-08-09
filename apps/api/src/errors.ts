import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const asyncHandler = (
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler => (request, response, next) => {
  void handler(request, response, next).catch(next);
};

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: { code: "not_found", message: "The requested resource was not found." },
  });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  console.error("Unhandled API error", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  response.status(500).json({
    error: { code: "internal_error", message: "An unexpected error occurred." },
  });
};
