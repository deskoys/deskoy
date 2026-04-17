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
      <stop offset="0%" stop-color="#141726"/>
      <stop offset="55%" stop-color="#0f111c"/>
      <stop offset="100%" stop-color="#0a0b12"/>
    </linearGradient>
    <radialGradient id="glowA" cx="28%" cy="18%" r="85%">
      <stop offset="0%" stop-color="rgba(110,168,255,0.22)"/>
      <stop offset="62%" stop-color="rgba(110,168,255,0.08)"/>
      <stop offset="100%" stop-color="rgba(110,168,255,0)"/>
    </radialGradient>
    <radialGradient id="glowB" cx="86%" cy="28%" r="78%">
      <stop offset="0%" stop-color="rgba(168,210,255,0.14)"/>
      <stop offset="70%" stop-color="rgba(168,210,255,0.06)"/>
      <stop offset="100%" stop-color="rgba(168,210,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glowA)"/>
  <rect width="100%" height="100%" fill="url(#glowB)"/>
  <text x="50%" y="${H - 48}" text-anchor="middle" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="15" font-weight="600" fill="rgba(255,255,255,0.56)">Installing Deskoy</text>
  <text x="50%" y="${H - 26}" text-anchor="middle" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" fill="rgba(255,255,255,0.30)">This will only take a moment</text>
</svg>`,
    'utf8',
  );

  const pipeline = sharp(svg).resize(W, H);

  if (fs.existsSync(logoPath)) {
    const logoSize = 116;
    const logoBuf = await sharp(logoPath)
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const left = Math.round((W - logoSize) / 2);
    const top = Math.round((H - logoSize) / 2 - 30);
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
