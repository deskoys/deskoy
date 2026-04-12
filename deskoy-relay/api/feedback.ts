import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clampDiscordContent, postDiscordWebhook } from '../lib/discord';
import { isValidEmail, MAX_DIAGNOSTICS_JSON_LEN, MAX_MESSAGE_LEN } from '../lib/limits';

function formatDiagnostics(d: unknown): string {
  if (d === undefined || d === null) return '';
  let s: string;
  try {
    s = JSON.stringify(d, null, 2);
  } catch {
    return '';
  }
  if (s.length > MAX_DIAGNOSTICS_JSON_LEN) {
    return `${s.slice(0, MAX_DIAGNOSTICS_JSON_LEN - 24)}\n…(truncated)`;
  }
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const webhook = process.env.DISCORD_FEEDBACK_WEBHOOK_URL?.trim() || '';
  if (!webhook) {
    res.status(503).json({ ok: false, error: 'relay_not_configured' });
    return;
  }

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const message = String(body.message ?? '').trim();
  const email = String(body.email ?? '').trim();
  const diagnostics = body.diagnostics;

  if (!message) {
    res.status(400).json({ ok: false, error: 'missing_message' });
    return;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ ok: false, error: 'message_too_long' });
    return;
  }
  if (email && !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: 'invalid_email' });
    return;
  }

  const diagBlock = formatDiagnostics(diagnostics);
  const content =
    `**New Feedback**\n` +
    (email ? `**Email:** ${email}\n` : '') +
    `\n${clampDiscordContent(message, 1800)}\n` +
    (diagBlock ? `\n**Diagnostics**\n\`\`\`json\n${clampDiscordContent(diagBlock, 1200)}\n\`\`\`\n` : '');

  const result = await postDiscordWebhook({
    webhookUrl: webhook,
    username: 'Deskoy Feedback',
    content,
  });

  if (result.ok) {
    res.status(200).json({ ok: true });
    return;
  }
  res.status(502).json({ ok: false, error: result.error ?? 'discord_error' });
}
