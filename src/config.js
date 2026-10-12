const env = process.env;
const need = (k) => {
  if (!env[k]) throw new Error(`Missing required env var ${k} (see server/.env.example)`);
  return env[k];
};

export const config = {
  port: Number(env.PORT || 4000),
  isProd: env.NODE_ENV === 'production',
  clientUrl: env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: need('JWT_SECRET'),
  allowRegistration: env.ALLOW_REGISTRATION !== 'false',
  sendDelayMs: Number(env.SEND_DELAY_MS ?? 300),
  brevo: {
    apiKey: env.BREVO_API_KEY,
    senderEmail: env.BREVO_SENDER_EMAIL,
    senderName: env.BREVO_SENDER_NAME || 'MailReach',
    apiUrl: env.BREVO_API_URL || 'https://api.brevo.com/v3', // override only for local testing
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  },
  encryptionKey: env.ENCRYPTION_KEY, // 32 bytes, hex or base64 (see .env.example)
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  s3: {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || 'auto',
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // Keep attachments small: base64 in a MIME message grows ~33%, and Gmail caps a message at 25 MB
  maxAttachmentBytes: 4 * 1024 * 1024,
  maxRecipients: Number(env.MAX_RECIPIENTS ?? 300), // personal Gmail allows about 500 emails/day
};

if (!config.google.clientId || !config.google.clientSecret || !config.google.redirectUri || !config.encryptionKey) {
  console.warn('[config] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / ENCRYPTION_KEY not set: Gmail connection and sending are disabled until they are configured.');
}
