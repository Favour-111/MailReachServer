import { z } from 'zod';
import { sanitizeBody } from './template.js';

const text = (max) => z.string().trim().max(max).default('');

export const recipientSchema = z.object({
  name: text(200),
  email: z.string().trim().toLowerCase().email('Invalid email address').max(320),
  company: text(200),
  position: text(200),
  data: z.record(z.string().max(500)).default({}),
});

export const recipientsSchema = z
  .array(recipientSchema)
  .max(500, 'Too many recipients (max 500)')
  .transform((list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.email) && seen.add(r.email));
  });

export const subjectSchema = z.string().trim().max(500).transform((s) => s.replace(/[\r\n]+/g, ' '));
export const bodySchema = z.string().max(200_000).transform(sanitizeBody);
export const idsSchema = z.array(z.string()).max(20).default([]);
