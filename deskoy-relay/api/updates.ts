import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const title = (process.env.DESKOY_UPDATE_TITLE ?? '').trim();
  const version = (process.env.DESKOY_UPDATE_VERSION ?? '').trim();
  const notes = (process.env.DESKOY_UPDATE_NOTES ?? '').trim();
  const downloadUrl = (process.env.DESKOY_DOWNLOAD_URL ?? '').trim() || 'https://www.deskoy.com/download';
  const show = (process.env.DESKOY_UPDATE_SHOW ?? '').trim();

  // "1" shows, anything else hides (so you can stage content without surfacing it yet).
  const visible = show === '1' && (!!title || !!notes || !!version);

  res.status(200).json({
    ok: true,
    visible,
    title: title || undefined,
    version: version || undefined,
    notes: notes || undefined,
    downloadUrl,
  });
}

