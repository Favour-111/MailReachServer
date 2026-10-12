import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { COOKIE, requireAuth, setAuthCookie } from '../middleware.js';

const router = Router();
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

router.post('/register', async (req, res) => {
  if (!config.allowRegistration) return res.status(403).json({ error: 'Registration is disabled' });
  const { name, email, password } = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12) } });
  setAuthCookie(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password' });
  setAuthCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: publicUser(user), registrationOpen: config.allowRegistration });
});

router.get('/config', (req, res) => res.json({ registrationOpen: config.allowRegistration }));

export default router;
