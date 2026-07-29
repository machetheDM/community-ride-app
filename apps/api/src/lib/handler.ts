import { NextRequest, NextResponse } from "next/server";
import { AppError, ValidationError } from "./errors";
import { badRequest, serverError } from "./response";
import { logger } from "./logger";

type RouteHandler = (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const start = Date.now();
    try {
      const response = await handler(req, ctx);
      const duration = Date.now() - start;
      logger.info(`${req.method} ${new URL(req.url).pathname} → ${response.status} (${duration}ms)`, {
        method: req.method,
        path: new URL(req.url).pathname,
        status: response.status,
        durationMs: duration,
      });
      return response;
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof ValidationError) {
        logger.warn(`Validation error: ${error.message}`, { fields: error.fields, durationMs: duration });
        return badRequest(error.message, error.fields);
      }
      if (error instanceof AppError) {
        logger.warn(`App error: ${error.message}`, {
          code: error.code,
          statusCode: error.statusCode,
          durationMs: duration,
        });
        return NextResponse.json(
          { success: false, error: error.message, code: error.code },
          { status: error.statusCode }
        );
      }
      logger.error(`Unhandled error in ${req.method} ${new URL(req.url).pathname}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
        durationMs: duration,
      });
      return serverError(
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? error.message
            : "Internal server error"
          : "Internal server error"
      );
    }
  };
}
