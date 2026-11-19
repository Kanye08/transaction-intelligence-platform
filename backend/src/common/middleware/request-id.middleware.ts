import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Gives every request a correlation id, echoed on the response and attached to
 * logs and error payloads. Registered in main.ts ahead of the logger.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  (req as Request & { id: string }).id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
