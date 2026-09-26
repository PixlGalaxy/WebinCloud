import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Express 4 ignores rejected promises, so async handlers forward errors here. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
