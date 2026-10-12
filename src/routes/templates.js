import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware.js';
import { bodySchema, subjectSchema } from '../schemas.js';
import { STARTER_TEMPLATES } from '../starterTemplates.js';
import { AiError, generateTemplate, isAiConfigured } from '../services/ai.service.js';

const router = Router();
router.use(requireAuth);

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required').max(120),
  subject: subjectSchema,
  body: bodySchema,
});

router.get('/', async (req, res) => {
  const templates = await prisma.template.findMany({ where: { userId: req.userId }, orderBy: { updatedAt: 'desc' } });
  res.json({ templates });
});

router.get('/ai-status', (req, res) => res.json({ configured: isAiConfigured() }));

// Adds any starter templates the user doesn't already have (matched by name)
router.post('/starters', async (req, res) => {
  const have = new Set((await prisma.template.findMany({ where: { userId: req.userId }, select: { name: true } })).map((t) => t.name));
  const fresh = STARTER_TEMPLATES.filter((t) => !have.has(t.name));
  await prisma.template.createMany({ data: fresh.map((t) => ({ ...t, userId: req.userId })) });
  res.json({ added: fresh.length });
});

// Generates a draft template with AI. Not saved: the client lets the user review it first.
router.post('/generate', async (req, res) => {
  const { prompt, tone } = z.object({
    prompt: z.string().trim().min(5, 'Describe the email you want (at least a few words)').max(1000),
    tone: z.enum(['professional', 'friendly', 'confident', 'formal']).default('professional'),
  }).parse(req.body);
  try {
    const t = await generateTemplate({ prompt, tone });
    res.json({ template: { name: t.name, subject: subjectSchema.parse(t.subject), body: bodySchema.parse(t.body) } });
  } catch (e) {
    if (e instanceof AiError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

router.post('/', async (req, res) => {
  const data = templateSchema.parse(req.body);
  res.status(201).json({ template: await prisma.template.create({ data: { ...data, userId: req.userId } }) });
});

router.put('/:id', async (req, res) => {
  const data = templateSchema.parse(req.body);
  const { count } = await prisma.template.updateMany({ where: { id: req.params.id, userId: req.userId }, data });
  if (!count) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await prisma.template.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.json({ ok: true });
});

export default router;
