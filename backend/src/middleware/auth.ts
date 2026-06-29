import type { Request, Response, NextFunction } from 'express';
import { getUserFromToken } from '../lib/supabase.js';

// Augment Express Request with the authenticated user id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Verifies the Supabase JWT from `Authorization: Bearer <token>` (CLAUDE.md §8).
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res
      .status(401)
      .json({ error: { code: 'unauthorized', message: 'Missing bearer token.' } });
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return res
      .status(401)
      .json({ error: { code: 'unauthorized', message: 'Invalid or expired token.' } });
  }

  req.userId = user.id;
  next();
}
