import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './middleware.js';
import { resumeCampaigns } from './sender.js';
import auth from './routes/auth.js';
import drafts from './routes/drafts.js';
import templates from './routes/templates.js';
import attachments from './routes/attachments.js';
import campaigns from './routes/campaigns.js';
import gmail from './routes/gmail.js';

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const limiter = (windowMin, max) => rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please slow down' } });
app.use('/api', limiter(15, 600));
app.use('/api/auth/login', limiter(15, 20));
app.use('/api/auth/register', limiter(60, 10));
app.post('/api/campaigns', limiter(60, 20));
app.post('/api/gmail/connect', limiter(60, 20));
app.post('/api/templates/generate', limiter(60, 15)); // AI calls cost money

app.use('/api/auth', auth);
app.use('/api/drafts', drafts);
app.use('/api/templates', templates);
app.use('/api/attachments', attachments);
app.use('/api/campaigns', campaigns);
app.use('/api/gmail', gmail);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app from the same origin
const dist = path.resolve('../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);
app.listen(config.port, () => {
  console.log(`MailReach server on http://localhost:${config.port}`);
  resumeCampaigns();
});
