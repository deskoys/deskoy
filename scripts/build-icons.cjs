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

const ICON_BG = { r: 255, g: 255, b: 255, alpha: 1 };

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

async function renderIconPng(trimmedOrRaw) {
  return sharp(trimmedOrRaw)
    .resize(OUT_SIZE, OUT_SIZE, {
      fit: 'contain',
      background: ICON_BG,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
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
        .resize(s, s, {
          fit: 'contain',
          background: ICON_BG,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer(),
    ),
  );
  const icoBuf = await pngToIco(icoParts);
  fs.writeFileSync(iconIco, icoBuf);
  console.log('Wrote assets/icon.ico and assets/icon.png (trim + scale from assets/logo.png)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
