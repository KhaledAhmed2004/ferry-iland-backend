import type { Request, Response, NextFunction, RequestHandler } from 'express';

type Controller = Record<string, any>;

// Wrap controller handlers to auto-set controller/service labels in res.locals
export const labelController = <T extends Controller>(
  controller: T,
  controllerName: string,
  serviceMap?: Record<string, string>
): T => {
  const wrapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(controller)) {
    if (typeof value === 'function') {
      const original: RequestHandler = value as RequestHandler;

      const labeled: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
        try {
          // Set controller label automatically from controller name + method key
          (res.locals as any).controllerLabel = `${controllerName}.${key}`;
          // If a service label mapping is provided, set it
          const svc = serviceMap?.[key];
          if (svc) (res.locals as any).serviceLabel = svc;
        } catch {
          // no-op
        }
        return original(req, res, next);
      };

      wrapped[key] = labeled;
    } else {
      wrapped[key] = value;
    }
  }

  return wrapped as T;
};
