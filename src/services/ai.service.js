// Template generation with OpenAI. The API key stays on the server.
import { config } from '../config.js';

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const SYSTEM = `You write reusable professional email templates for job applications and outreach.
Return ONLY a JSON object: {"name": string, "subject": string, "body": string}.
- "name": short template title (max 5 words).
- "subject": concise subject line.
- "body": simple HTML using only <p>, <br>, <b>, <i>, <ul>, <ol>, <li>. Keep it under 180 words, warm and professional, no emojis.
- Personalise ONLY with these variables, written exactly like this: {{name}} (recipient), {{company}}, {{position}}, {{sender_name}}. Greet with "Dear {{name}}," or similar and sign off with {{sender_name}}.
- Never use bracket placeholders like [Your Name] and never invent facts about the sender.
- If the user mentions an attached CV or portfolio, say it is attached.`;

export const isAiConfigured = () => Boolean(config.openai.apiKey);

export async function generateTemplate({ prompt, tone }) {
  if (!isAiConfigured()) throw new AiError('AI is not configured on the server (set OPENAI_API_KEY).', 503);

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.openai.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.openai.model,
        temperature: 0.7,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Tone: ${tone}.\nWrite a template for: ${prompt}` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    console.error('[ai] network error:', e.message);
    throw new AiError('Could not reach the AI service. Please try again.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[ai] OpenAI error ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 401) throw new AiError('The OpenAI API key was rejected. Check OPENAI_API_KEY on the server.');
    if (res.status === 429) throw new AiError('AI rate limit or quota reached. Try again shortly, or check your OpenAI billing.', 429);
    throw new AiError('The AI service had a problem. Please try again.');
  }

  try {
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    if (!out.subject || !out.body) throw new Error('missing fields');
    return { name: String(out.name || 'AI template').slice(0, 120), subject: String(out.subject), body: String(out.body) };
  } catch (e) {
    console.error('[ai] bad response shape:', e.message);
    throw new AiError('The AI returned an unexpected response. Please try again.');
  }
}
