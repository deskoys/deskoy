import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clampDiscordContent, decodeDataUrlImage, postDiscordWebhook } from '../lib/discord';
import {
  isValidEmail,
  MAX_DIAGNOSTICS_JSON_LEN,
  MAX_MESSAGE_LEN,
  MAX_SCREENSHOT_BYTES,
  MAX_STEPS_LEN,
} from '../lib/limits';

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

  const webhook = process.env.DISCORD_BUG_WEBHOOK_URL?.trim() || '';
  if (!webhook) {
    res.status(503).json({ ok: false, error: 'relay_not_configured' });
    return;
  }

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const message = String(body.message ?? '').trim();
  const email = String(body.email ?? '').trim();
  const steps = String(body.steps ?? '').trim();
  const screenshot = body.screenshot != null ? String(body.screenshot) : '';
  const diagnostics = body.diagnostics;

  if (!message) {
    res.status(400).json({ ok: false, error: 'missing_message' });
    return;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ ok: false, error: 'message_too_long' });
    return;
  }
  if (steps.length > MAX_STEPS_LEN) {
    res.status(400).json({ ok: false, error: 'steps_too_long' });
    return;
  }
  if (email && !isValidEmail(email)) {
    res.status(400).json({ ok: false, error: 'invalid_email' });
    return;
  }

  let file: { filename: string; mime: string; buffer: Buffer } | undefined;
  if (screenshot) {
    const decoded = decodeDataUrlImage(screenshot);
    if (!decoded) {
      res.status(400).json({ ok: false, error: 'invalid_screenshot' });
      return;
    }
    if (decoded.buffer.length > MAX_SCREENSHOT_BYTES) {
      res.status(400).json({ ok: false, error: 'screenshot_too_large' });
      return;
    }
    const ext = decoded.mime === 'image/png' ? 'png' : decoded.mime === 'image/gif' ? 'gif' : 'jpg';
    file = { filename: `screenshot.${ext}`, mime: decoded.mime, buffer: decoded.buffer };
  }

  const diagBlock = formatDiagnostics(diagnostics);
  const content =
    `**New Bug Report**\n` +
    (email ? `**Email:** ${email}\n` : '') +
    `\n**What happened**\n${clampDiscordContent(message, 1600)}\n` +
    (steps ? `\n**Steps to reproduce**\n${clampDiscordContent(steps, 1200)}\n` : '') +
    (diagBlock ? `\n**Diagnostics**\n\`\`\`json\n${clampDiscordContent(diagBlock, 1000)}\n\`\`\`\n` : '');

  const result = await postDiscordWebhook({
    webhookUrl: webhook,
    username: 'Deskoy Bug Report',
    content,
    file,
  });

  if (result.ok) {
    res.status(200).json({ ok: true });
    return;
  }
  res.status(502).json({ ok: false, error: result.error ?? 'discord_error' });
}
