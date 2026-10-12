import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware.js';
import { bodySchema, idsSchema, recipientsSchema } from '../schemas.js';

const router = Router();
router.use(requireAuth);

const draftSchema = z.object({
  subject: z.string().trim().max(500).default(''),
  body: bodySchema.default(''),
  recipients: recipientsSchema.default([]),
  attachmentIds: idsSchema,
});

async function withAttachments(userId, draft) {
  const attachments = await prisma.attachment.findMany({
    where: { userId, id: { in: draft.attachmentIds } },
    select: { id: true, filename: true, size: true, mimeType: true },
  });
  return { ...draft, attachments };
}

router.get('/', async (req, res) => {
  const drafts = await prisma.draft.findMany({ where: { userId: req.userId }, orderBy: { updatedAt: 'desc' } });
  res.json({
    drafts: drafts.map((d) => ({
      id: d.id, subject: d.subject, recipientCount: d.recipients.length,
      attachmentCount: d.attachmentIds.length, createdAt: d.createdAt, updatedAt: d.updatedAt,
    })),
  });
});

router.get('/:id', async (req, res) => {
  const draft = await prisma.draft.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json({ draft: await withAttachments(req.userId, draft) });
});

router.post('/', async (req, res) => {
  const data = draftSchema.parse(req.body);
  const draft = await prisma.draft.create({ data: { ...data, userId: req.userId } });
  res.status(201).json({ draft });
});

router.put('/:id', async (req, res) => {
  const data = draftSchema.parse(req.body);
  const { count } = await prisma.draft.updateMany({ where: { id: req.params.id, userId: req.userId }, data });
  if (!count) return res.status(404).json({ error: 'Draft not found' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await prisma.draft.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.json({ ok: true });
});

export default router;
