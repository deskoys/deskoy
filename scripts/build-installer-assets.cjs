/**
 * Builds NSIS installer branding assets (sidebar + header).
 *
 * NSIS Modern UI (MUI2) expects:
 * - Sidebar image: 164×314 (BMP)
 * - Header image: 150×57 (BMP)
 *
 * This script renders crisp PNGs from SVG and writes BMPs for NSIS.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const bmp = require('bmp-js');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');

const logoPath = path.join(assets, 'logo.png');

const sidebarBmp = path.join(assets, 'installer-sidebar.bmp');
const headerBmp = path.join(assets, 'installer-header.bmp');

const SIDEBAR_W = 164;
const SIDEBAR_H = 314;
const HEADER_W = 150;
const HEADER_H = 57;

function svgSidebar() {
  // Keep this high-contrast and low-detail: NSIS assets get scaled by Windows DPI,
  // and fine detail can look blurry. Big shapes + crisp text reads best.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDEBAR_W}" height="${SIDEBAR_H}" viewBox="0 0 ${SIDEBAR_W} ${SIDEBAR_H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1224"/>
      <stop offset="60%" stop-color="#0A0F1E"/>
      <stop offset="100%" stop-color="#070A13"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="18%" r="75%">
      <stop offset="0%" stop-color="rgba(122,136,255,0.26)"/>
      <stop offset="70%" stop-color="rgba(122,136,255,0.08)"/>
      <stop offset="100%" stop-color="rgba(122,136,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>

  <!-- Crisp accent bars (better than tiny dots on scaled displays) -->
  <rect x="0" y="0" width="6" height="${SIDEBAR_H}" fill="rgba(122,136,255,0.55)"/>
  <rect x="6" y="0" width="1" height="${SIDEBAR_H}" fill="rgba(255,255,255,0.10)"/>
  <rect x="0" y="${SIDEBAR_H - 84}" width="${SIDEBAR_W}" height="1" fill="rgba(255,255,255,0.10)"/>

  <text x="16" y="${SIDEBAR_H - 38}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" font-weight="600" fill="rgba(255,255,255,0.78)">Deskoy</text>
  <text x="16" y="${SIDEBAR_H - 20}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="10.5" fill="rgba(255,255,255,0.44)">Privacy cover for work</text>
</svg>`,
    'utf8',
  );
}

function svgHeader() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEADER_W}" height="${HEADER_H}" viewBox="0 0 ${HEADER_W} ${HEADER_H}">
  <defs>
    <linearGradient id="h" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0B1224"/>
      <stop offset="60%" stop-color="#0A0F1E"/>
      <stop offset="100%" stop-color="#070A13"/>
    </linearGradient>
    <radialGradient id="hg" cx="25%" cy="50%" r="70%">
      <stop offset="0%" stop-color="rgba(122,136,255,0.22)"/>
      <stop offset="100%" stop-color="rgba(120,138,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#h)"/>
  <rect width="100%" height="100%" fill="url(#hg)"/>
  <text x="12" y="34" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="rgba(255,255,255,0.85)">Deskoy</text>
</svg>`,
    'utf8',
  );
}

async function maybeCompositeLogo(pipeline, targetW, targetH, size, topOffset) {
  if (!fs.existsSync(logoPath)) return pipeline;
  const logo = await sharp(logoPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const left = Math.max(0, Math.round((targetW - size) / 2));
  const top = Math.max(0, Math.round(topOffset));
  return pipeline.composite([{ input: logo, left, top }]);
}

async function renderBmp(svgBuf, outPath, w, h, composite) {
  let p = sharp(svgBuf).resize(w, h, { fit: 'fill' }).flatten({ background: { r: 11, g: 18, b: 36 } });
  if (composite) p = await composite(p);
  // Force opaque pixels. NSIS bitmaps with alpha can look “soft” on some Windows themes/scaling.
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
  const encoded = bmp.encode({
    data,
    width: info.width,
    height: info.height,
  });
  fs.writeFileSync(outPath, encoded.data);
}

async function main() {
  if (!fs.existsSync(assets)) fs.mkdirSync(assets, { recursive: true });

  await renderBmp(svgSidebar(), sidebarBmp, SIDEBAR_W, SIDEBAR_H, async (p) =>
    maybeCompositeLogo(p, SIDEBAR_W, SIDEBAR_H, 92, 92),
  );

  await renderBmp(svgHeader(), headerBmp, HEADER_W, HEADER_H, async (p) =>
    maybeCompositeLogo(p, HEADER_W, HEADER_H, 28, 14),
  );

  console.log('Wrote NSIS installer assets:', path.relative(root, sidebarBmp), 'and', path.relative(root, headerBmp));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

