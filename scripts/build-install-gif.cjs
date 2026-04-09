/**
 * Squirrel.Windows shows loadingGif during Setup. Default is Electron’s mint “code” GIF.
 * This builds a dark, on-brand static GIF (493×312 — common Squirrel size) from assets/logo.png.
 *
 * Run: npm run build:install-gif (also runs before package/make via npm scripts)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const logoPath = path.join(assets, 'logo.png');
const outPath = path.join(assets, 'install-loading.gif');

/** Squirrel / WiX installers traditionally use this aspect ratio for the splash GIF. */
const W = 493;
const H = 312;

async function main() {
  if (!fs.existsSync(assets)) fs.mkdirSync(assets, { recursive: true });

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16161a"/>
      <stop offset="55%" stop-color="#111113"/>
      <stop offset="100%" stop-color="#0a0a0c"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.04)"/>
      <stop offset="40%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#shine)"/>
  <text x="50%" y="${H - 46}" text-anchor="middle" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="15" font-weight="500" fill="rgba(255,255,255,0.5)">Installing Deskoy</text>
  <text x="50%" y="${H - 24}" text-anchor="middle" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" fill="rgba(255,255,255,0.28)">This will only take a moment</text>
</svg>`,
    'utf8',
  );

  const pipeline = sharp(svg).resize(W, H);

  if (fs.existsSync(logoPath)) {
    const logoSize = 112;
    const logoBuf = await sharp(logoPath)
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const left = Math.round((W - logoSize) / 2);
    const top = Math.round((H - logoSize) / 2 - 28);
    await pipeline
      .composite([{ input: logoBuf, left, top }])
      .gif({ colours: 256, effort: 7 })
      .toFile(outPath);
  } else {
    await pipeline.gif({ colours: 256, effort: 7 }).toFile(outPath);
  }

  console.log('Wrote assets/install-loading.gif (Squirrel installer splash)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
