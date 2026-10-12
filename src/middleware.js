import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { config } from './config.js';

export const COOKIE = 'mr_token';

export function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', issues: err.issues });
  }
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large' });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}
