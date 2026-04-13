import type { VercelRequest, VercelResponse } from '@vercel/node';

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const minimumVersion = (process.env.DESKOY_MINIMUM_VERSION ?? '').trim();
  const blockedVersions = parseCsv(process.env.DESKOY_BLOCKED_VERSIONS);
  const message =
    (process.env.DESKOY_VERSION_MESSAGE ?? '').trim() ||
    'This version is discontinued. Please install the latest Deskoy to keep using it.';
  const downloadUrl = (process.env.DESKOY_DOWNLOAD_URL ?? '').trim() || 'https://www.deskoy.com/download';

  res.status(200).json({
    ok: true,
    minimumVersion: minimumVersion || undefined,
    blockedVersions,
    message,
    downloadUrl,
  });
}
