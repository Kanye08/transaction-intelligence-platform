import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * RFC 7807-style error responses.
 *
 * Every failure leaves the API in the same shape, carries the request id for
 * correlation, and never leaks stack traces, SQL or provider internals to the
 * client. Unexpected errors are logged in full server-side.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId?: string;
  instance?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function codeFromStatus(status: number): string {
  return (TITLES[status] ?? 'Error').toUpperCase().replace(/\s+/g, '_');
}

interface HttpError extends Error {
  status: number;
  expose?: boolean;
}

/** Recognises the http-errors shape used by Express middleware. */
function isHttpError(error: unknown): error is HttpError {
  if (!(error instanceof Error)) return false;
  const status = (error as Partial<HttpError>).status;
  return typeof status === 'number' && status >= 400 && status < 600;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const problem = this.toProblem(exception);
    problem.requestId = request.id;
    problem.instance = request.originalUrl;

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${problem.status}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // class-validator failures arrive as { message: string[] }.
      if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        const messages = body['message'];
        const problem: ProblemDetails = {
          type: 'about:blank',
          title: (body['error'] as string) ?? TITLES[status] ?? 'Error',
          status,
          detail: Array.isArray(messages)
            ? 'Request validation failed.'
            : ((messages as string) ?? exception.message),
          code: (body['code'] as string) ?? codeFromStatus(status),
        };
        if (Array.isArray(messages)) {
          problem.validationErrors = messages;
        }
        for (const [key, value] of Object.entries(body)) {
          if (!['message', 'error', 'statusCode', 'code'].includes(key)) {
            problem[key] = value;
          }
        }
        return problem;
      }

      return {
        type: 'about:blank',
        title: TITLES[status] ?? 'Error',
        status,
        detail: String(payload),
        code: codeFromStatus(status),
      };
    }

    // Errors thrown by Express middleware (body parser, CORS) follow the
    // http-errors shape rather than Nest's, and would otherwise all surface
    // as 500s - a malformed or oversized body is a client error.
    if (isHttpError(exception)) {
      const status = exception.status;
      return {
        type: 'about:blank',
        title: TITLES[status] ?? 'Error',
        status,
        detail: exception.expose ? exception.message : 'The request could not be processed.',
        code: codeFromStatus(status),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          type: 'about:blank',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: 'A record with the same unique identifier already exists.',
          code: 'DUPLICATE_RECORD',
        };
      }
      if (exception.code === 'P2025') {
        return {
          type: 'about:blank',
          title: 'Not Found',
          status: HttpStatus.NOT_FOUND,
          detail: 'The requested resource does not exist.',
          code: 'NOT_FOUND',
        };
      }
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred. The request id can be used to trace it.',
      code: 'INTERNAL_ERROR',
    };
  }
}
