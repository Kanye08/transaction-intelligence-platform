import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Every request gets a correlation id, echoed back on the response and
 * attached to structured logs and error payloads, so a user-reported failure
 * can be traced to a single log line.
 *
 * Registered with app.use() in main.ts: it must run before the logger, ahead
 * of any route matching.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  (req as Request & { id: string }).id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
