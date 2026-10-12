import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware.js';
import { putFile, deleteFile } from '../storage.js';

const router = Router();
router.use(requireAuth);

// Extension allow-list (no executables/scripts). mail providers block many of those anyway.
const ALLOWED = new Set(['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.zip']);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxAttachmentBytes, files: 1 } });

router.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = path.basename(file.originalname).replace(/[^\w.\- ()]+/g, '_').slice(0, 150) || 'file';
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED.has(ext)) return res.status(400).json({ error: `${ext || 'This'} files are not allowed` });
  // PDFs must actually be PDFs
  if (ext === '.pdf' && file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ error: 'File is not a valid PDF' });
  }
  const storageKey = `${req.userId}-${crypto.randomUUID()}${ext}`;
  await putFile(storageKey, file.buffer, file.mimetype);
  const attachment = await prisma.attachment.create({
    data: { userId: req.userId, filename, mimeType: file.mimetype, size: file.size, storageKey },
    select: { id: true, filename: true, size: true, mimeType: true },
  });
  res.status(201).json({ attachment });
});

router.delete('/:id', async (req, res) => {
  const a = await prisma.attachment.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (a) {
    await prisma.attachment.delete({ where: { id: a.id } });
    await deleteFile(a.storageKey);
  }
  res.json({ ok: true });
});

export default router;
