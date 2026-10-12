import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware.js';
import { bodySchema, idsSchema, recipientsSchema, subjectSchema } from '../schemas.js';
import { runCampaign } from '../sender.js';
import { getConnection, isOAuthConfigured } from '../services/gmail.service.js';

const router = Router();
router.use(requireAuth);

const sendSchema = z.object({
  subject: subjectSchema.pipe(z.string().min(1, 'Subject is required')),
  body: bodySchema.refine((b) => b.replace(/<[^>]*>|&nbsp;|\s/g, ''), 'Email content is required'),
  recipients: recipientsSchema.pipe(z.array(z.any()).min(1, 'Add at least one recipient')),
  attachmentIds: idsSchema,
});

const summary = (c) => ({
  id: c.id, subject: c.subject, status: c.status, totalRecipients: c.totalRecipients,
  successfulCount: c.successfulCount, failedCount: c.failedCount, createdAt: c.createdAt, sentAt: c.sentAt,
  provider: c.provider, senderEmail: c.senderEmail,
});

// Non-secret sending info for the UI: the logged-in user's own connected Gmail (tokens never leave the server)
router.get('/sender', async (req, res) => {
  const [conn, user] = await Promise.all([getConnection(req.userId), prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } })]);
  res.json({
    oauthConfigured: isOAuthConfigured(),
    configured: Boolean(conn && conn.status === 'active'),
    needsReconnect: conn?.status === 'needs_reconnect',
    email: conn?.gmailAddress ?? null,
    name: user?.name ?? '',
    maxRecipients: config.maxRecipients,
  });
});

router.get('/stats', async (req, res) => {
  const where = { userId: req.userId };
  const [totals, drafts, templates, recent] = await Promise.all([
    prisma.emailCampaign.aggregate({ where, _sum: { successfulCount: true, failedCount: true } }),
    prisma.draft.count({ where }),
    prisma.template.count({ where }),
    prisma.emailCampaign.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  res.json({
    sent: totals._sum.successfulCount ?? 0,
    failed: totals._sum.failedCount ?? 0,
    drafts, templates,
    recent: recent.map(summary),
  });
});

router.get('/', async (req, res) => {
  const campaigns = await prisma.emailCampaign.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ campaigns: campaigns.map(summary) });
});

router.get('/:id', async (req, res) => {
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { recipients: { orderBy: { id: 'asc' }, select: { id: true, name: true, email: true, company: true, position: true, status: true, errorMessage: true } } },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  const attachments = await prisma.attachment.findMany({
    where: { userId: req.userId, id: { in: campaign.attachmentIds } },
    select: { id: true, filename: true, size: true },
  });
  res.json({ campaign: { ...summary(campaign), body: campaign.body, recipients: campaign.recipients, attachments } });
});

router.post('/', async (req, res) => {
  const data = sendSchema.parse(req.body);
  if (data.recipients.length > config.maxRecipients) {
    return res.status(400).json({ error: `Too many recipients (max ${config.maxRecipients})` });
  }
  const conn = await getConnection(req.userId);
  if (!conn) return res.status(409).json({ error: 'Connect your Gmail account in Settings before sending.', code: 'gmail_not_connected' });
  if (conn.status !== 'active') return res.status(409).json({ error: 'Your Gmail connection has expired or was revoked. Reconnect Gmail in Settings.', code: 'gmail_reconnect' });

  const files = await prisma.attachment.findMany({ where: { userId: req.userId, id: { in: data.attachmentIds } } });
  if (files.length !== data.attachmentIds.length) return res.status(400).json({ error: 'An attachment no longer exists. Please re-add it.' });
  if (files.reduce((n, f) => n + f.size, 0) > config.maxAttachmentBytes) {
    return res.status(400).json({ error: 'Attachments are too large (4 MB total maximum)' });
  }

  const campaign = await prisma.emailCampaign.create({
    data: {
      userId: req.userId,
      subject: data.subject,
      body: data.body,
      totalRecipients: data.recipients.length,
      attachmentIds: data.attachmentIds,
      provider: 'gmail',
      senderEmail: conn.gmailAddress,
      recipients: { create: data.recipients },
    },
  });
  runCampaign(campaign.id); // fire and forget; the client polls GET /:id
  res.status(201).json({ id: campaign.id });
});

router.post('/:id/cancel', async (req, res) => {
  await prisma.emailCampaign.updateMany({ where: { id: req.params.id, userId: req.userId, status: 'sending' }, data: { status: 'cancelled' } });
  res.json({ ok: true });
});

router.post('/:id/retry', async (req, res) => {
  const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status === 'sending') return res.status(400).json({ error: 'Already sending' });
  const { count } = await prisma.emailRecipient.updateMany({
    where: { campaignId: c.id, status: { in: ['failed', 'pending'] } },
    data: { status: 'pending', errorMessage: null },
  });
  if (!count) return res.status(400).json({ error: 'Nothing to retry' });
  await prisma.emailCampaign.update({
    where: { id: c.id },
    data: { status: 'sending', failedCount: 0 },
  });
  runCampaign(c.id);
  res.json({ ok: true });
});

export default router;
