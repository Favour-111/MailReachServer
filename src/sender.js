// Background sender: sends one individual email per recipient through the campaign owner's own Gmail, sequentially, with a small delay.
// Runs in-process (no queue needed for ~5 users). Progress lives in the DB, so the UI just polls.
import { prisma } from './db.js';
import { config } from './config.js';
import { getFile } from './storage.js';
import { sendEmail, getConnection, GmailError } from './services/gmail.service.js';
import { renderTemplate, recipientVars, htmlToText } from './template.js';

const running = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (html) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${html}</div>`;

export async function runCampaign(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await process(id);
  } catch (e) {
    console.error(`Campaign ${id} crashed:`, e);
    await prisma.emailRecipient.updateMany({
      where: { campaignId: id, status: 'pending' },
      data: { status: 'failed', errorMessage: 'Sending was interrupted unexpectedly' },
    });
    await finish(id);
  } finally {
    running.delete(id);
  }
}

async function failRemaining(id, message) {
  await prisma.emailRecipient.updateMany({ where: { campaignId: id, status: 'pending' }, data: { status: 'failed', errorMessage: message } });
}

async function finish(id) {
  const [sent, failed] = await Promise.all([
    prisma.emailRecipient.count({ where: { campaignId: id, status: 'sent' } }),
    prisma.emailRecipient.count({ where: { campaignId: id, status: 'failed' } }),
  ]);
  const c = await prisma.emailCampaign.findUnique({ where: { id }, select: { status: true } });
  await prisma.emailCampaign.update({
    where: { id },
    data: { successfulCount: sent, failedCount: failed, status: c.status === 'cancelled' ? 'cancelled' : 'completed', sentAt: new Date() },
  });
}

async function process(id) {
  const campaign = await prisma.emailCampaign.findUnique({ where: { id }, include: { user: true } });
  if (!campaign || campaign.status !== 'sending') return;

  const conn = await getConnection(campaign.userId);
  if (!conn || conn.status !== 'active') {
    await failRemaining(id, conn ? 'Your Gmail connection has expired or was revoked. Reconnect Gmail in Settings, then retry.' : 'Gmail is not connected. Connect it in Settings, then retry.');
    return finish(id);
  }

  const files = await prisma.attachment.findMany({ where: { userId: campaign.userId, id: { in: campaign.attachmentIds } } });
  const attachments = [];
  for (const f of files) attachments.push({ filename: f.filename, content: await getFile(f.storageKey) });

  const pending = await prisma.emailRecipient.findMany({ where: { campaignId: id, status: 'pending' }, orderBy: { id: 'asc' } });

  for (const r of pending) {
    // Re-read status so Cancel takes effect between emails
    const { status } = await prisma.emailCampaign.findUnique({ where: { id }, select: { status: true } });
    if (status === 'cancelled') break;

    const vars = recipientVars(r, campaign.user.name);
    try {
      const html = renderTemplate(campaign.body, vars, { html: true });
      const messageId = await sendEmail({
        userId: campaign.userId,
        fromName: campaign.user.name,
        to: { email: r.email, name: r.name },
        subject: renderTemplate(campaign.subject, vars),
        html: wrap(html),
        text: htmlToText(html),
        attachments,
      });
      await prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'sent', errorMessage: null, providerMessageId: messageId } });
      await prisma.emailCampaign.update({ where: { id }, data: { successfulCount: { increment: 1 } } });
    } catch (e) {
      const message = e instanceof GmailError ? e.userMessage : 'Unexpected error while sending';
      if (!(e instanceof GmailError)) console.error('[sender] unexpected error:', e);
      if (e.fatal) {
        // Revoked/expired Gmail access or daily limit reached: everything else would fail the same way
        await prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'failed', errorMessage: message } });
        await failRemaining(id, message);
        break;
      }
      await prisma.emailRecipient.update({ where: { id: r.id }, data: { status: 'failed', errorMessage: message } });
      await prisma.emailCampaign.update({ where: { id }, data: { failedCount: { increment: 1 } } });
    }
    await sleep(config.sendDelayMs);
  }
  await finish(id);
}

// After a server restart, pick up campaigns that were mid-send.
export async function resumeCampaigns() {
  const stale = await prisma.emailCampaign.findMany({ where: { status: 'sending' }, select: { id: true } });
  stale.forEach((c) => runCampaign(c.id));
}
