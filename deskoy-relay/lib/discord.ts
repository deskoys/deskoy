export function normalizeDiscordWebhookUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    const hostOk =
      u.hostname === 'discord.com' ||
      u.hostname === 'canary.discord.com' ||
      u.hostname === 'ptb.discord.com';
    if (!hostOk) return '';
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return '';
    if (parts[0] !== 'api' || parts[1] !== 'webhooks') return '';
    if (!/^\d+$/.test(parts[2] ?? '')) return '';
    if (!(parts[3] ?? '').length) return '';
    return u.toString();
  } catch {
    return '';
  }
}

/** Discord message content max 2000; leave margin. */
export function clampDiscordContent(s: string, max = 1900): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function postDiscordWebhook(args: {
  webhookUrl: string;
  username: string;
  content: string;
  file?: { filename: string; mime: string; buffer: Buffer };
}): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = normalizeDiscordWebhookUrl(args.webhookUrl);
  if (!webhookUrl) return { ok: false, error: 'invalid_webhook' };

  const content = clampDiscordContent(args.content);
  const payload = { username: args.username, content };

  try {
    if (args.file) {
      const form = new FormData();
      form.set('payload_json', JSON.stringify(payload));
      form.set('files[0]', new Blob([args.file.buffer], { type: args.file.mime }), args.file.filename);
      const resp = await fetch(webhookUrl, { method: 'POST', body: form });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        return { ok: false, error: `discord_http_${resp.status}${t ? `:${t.slice(0, 120)}` : ''}` };
      }
      return { ok: true };
    }

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { ok: false, error: `discord_http_${resp.status}${t ? `:${t.slice(0, 120)}` : ''}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

export function decodeDataUrlImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) return null;
  const mime = m[1].trim().toLowerCase();
  const b64 = m[2].trim();
  if (!mime.startsWith('image/')) return null;
  try {
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}
