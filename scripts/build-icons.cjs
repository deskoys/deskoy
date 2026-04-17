/**
 * Builds Windows/Linux packager icons from assets/logo.png.
 * Trims uniform border (e.g. white padding) then scales the artwork to fill the icon.
 *
 * Replace logo.png with your own square artwork, then run: npm run build:icons
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pngToIco = require('png-to-ico');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const logoPath = path.join(assets, 'logo.png');
const iconIco = path.join(assets, 'icon.ico');
const iconPng = path.join(assets, 'icon.png');

const OUT_SIZE = 256;
/** ICO sizes Windows commonly uses (largest first is fine for png-to-ico). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Transparent background, with a subtle glow for legibility on dark UI surfaces.
const ICON_BG = { r: 0, g: 0, b: 0, alpha: 0 };

function roundedMaskSvg(size, radius) {
  const r = Math.max(0, Math.min(radius, Math.floor(size / 2)));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>
</svg>`,
    'utf8',
  );
}

async function applyRoundedCornersPng(pngBuffer, size) {
  // A modern rounded-square silhouette.
  // Keep this subtle — curved corners, not a circle.
  const radius = Math.round(size * 0.14);
  const mask = roundedMaskSvg(size, radius);
  return sharp(pngBuffer).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

function writePlaceholderLogo() {
  const w = 256;
  const h = 256;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      png.data[idx] = 68;
      png.data[idx + 1] = 76;
      png.data[idx + 2] = 239;
      png.data[idx + 3] = 255;
    }
  }
  fs.writeFileSync(logoPath, PNG.sync.write(png));
  console.log('Created placeholder assets/logo.png — replace it with your real logo, then run npm run build:icons again.');
}

/**
 * Trim padding matching the top-left pixel; skip trim if it would collapse a flat image.
 */
async function trimPaddingIfSensible(inputPath) {
  const raw = fs.readFileSync(inputPath);
  let pipeline = sharp(raw).ensureAlpha();
  let trimmed;
  try {
    trimmed = await pipeline.clone().trim({ threshold: 12 }).png().toBuffer();
  } catch {
    return raw;
  }
  const meta = await sharp(trimmed).metadata();
  if (!meta.width || !meta.height || meta.width < 24 || meta.height < 24) {
    return raw;
  }
  return trimmed;
}

async function addSubtleGlow(pngBuffer) {
  // Windows task switcher tiles can be dark; a faint glow keeps thin strokes visible
  // without adding a solid background.
  const glow = await sharp(pngBuffer)
    .blur(10)
    .tint({ r: 235, g: 246, b: 255 }) // cool white
    .modulate({ brightness: 1.05 })
    .png()
    .toBuffer();

  return sharp({
    create: { width: OUT_SIZE, height: OUT_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: glow, blend: 'over', opacity: 0.55 },
      { input: pngBuffer, blend: 'over' },
    ])
    .png()
    .toBuffer();
}

async function renderIconPng(trimmedOrRaw) {
  const pngBuf = await sharp(trimmedOrRaw)
    .ensureAlpha()
    .resize(OUT_SIZE, OUT_SIZE, {
      fit: 'contain',
      background: ICON_BG,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const withGlow = await addSubtleGlow(pngBuf);
  return applyRoundedCornersPng(withGlow, OUT_SIZE);
}

(async () => {
  if (!fs.existsSync(assets)) fs.mkdirSync(assets, { recursive: true });

  if (!fs.existsSync(logoPath)) {
    writePlaceholderLogo();
  }

  const trimmed = await trimPaddingIfSensible(logoPath);
  const mainPng = await renderIconPng(trimmed);
  fs.writeFileSync(iconPng, mainPng);

  const icoParts = await Promise.all(
    ICO_SIZES.map((s) =>
      sharp(trimmed)
        .ensureAlpha()
        .resize(s, s, {
          fit: 'contain',
          background: ICON_BG,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer()
        .then(async (buf) => {
          // Match the PNG: faint glow, then rounded mask.
          const glow = await sharp(buf)
            .blur(Math.max(1, Math.round(s / 24)))
            .tint({ r: 235, g: 246, b: 255 })
            .modulate({ brightness: 1.05 })
            .png()
            .toBuffer();
          const composed = await sharp({
            create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
          })
            .composite([
              { input: glow, blend: 'over', opacity: 0.55 },
              { input: buf, blend: 'over' },
            ])
            .png()
            .toBuffer();
          return applyRoundedCornersPng(composed, s);
        }),
    ),
  );
  const icoBuf = await pngToIco(icoParts);
  fs.writeFileSync(iconIco, icoBuf);
  console.log('Wrote assets/icon.ico and assets/icon.png (trim + scale from assets/logo.png)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
