/**
 * generate-installer-assets.mjs — Generate branded BMP images for NSIS and WiX installers.
 *
 * Produces:
 *   - src-tauri/icons/installer-header.bmp (493×58, WiX banner)
 *   - src-tauri/icons/installer-dialog.bmp (493×312, WiX dialog)
 *   - src-tauri/icons/installer-sidebar.bmp (164×314, NSIS sidebar)
 *   - src-tauri/icons/installer-header-nsis.bmp (150×57, NSIS header)
 *
 * Design: deep slate background (#1e293b) + signal gradient chameleon logo + "OverlayTrans" text.
 * Format: 24-bit BMP (no alpha channel), as required by Windows installers.
 *
 * Usage:
 *   node scripts/generate-installer-assets.mjs
 *
 * Prerequisites:
 *   - npm install (sharp must be available)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBrandIcon } from "./lib/render-brand-icon.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ICONS_DIR = resolve(ROOT, "src-tauri", "icons");

/**
 * Encode RGBA pixel data as a 24-bit BMP file (no alpha).
 * @param {Buffer} rgba - Raw RGBA pixel data (top-down, left-to-right)
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Buffer} BMP file data
 */
function encodeBmp24(rgba, width, height) {
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const paddedRowBytes = rowBytes + padding;
  const pixelDataSize = paddedRowBytes * height;
  const fileSize = 14 + 40 + pixelDataSize;

  const buf = Buffer.alloc(fileSize);
  let off = 0;

  // ── BMP file header (14 bytes) ──
  buf.writeUInt8(0x42, off++); // 'B'
  buf.writeUInt8(0x4d, off++); // 'M'
  buf.writeUInt32LE(fileSize, off); off += 4;
  buf.writeUInt16LE(0, off); off += 2; // reserved
  buf.writeUInt16LE(0, off); off += 2; // reserved
  buf.writeUInt32LE(14 + 40, off); off += 4; // pixel data offset

  // ── BITMAPINFOHEADER (40 bytes) ──
  buf.writeUInt32LE(40, off); off += 4; // header size
  buf.writeInt32LE(width, off); off += 4;
  buf.writeInt32LE(height, off); off += 4; // positive = bottom-up
  buf.writeUInt16LE(1, off); off += 2; // color planes
  buf.writeUInt16LE(24, off); off += 2; // bits per pixel
  buf.writeUInt32LE(0, off); off += 4; // compression (none)
  buf.writeUInt32LE(pixelDataSize, off); off += 4;
  buf.writeInt32LE(2835, off); off += 4; // h pixels/meter (~72 DPI)
  buf.writeInt32LE(2835, off); off += 4; // v pixels/meter
  buf.writeUInt32LE(0, off); off += 4; // colors in palette
  buf.writeUInt32LE(0, off); off += 4; // important colors

  // ── Pixel data (bottom-up, BGR) ──
  const padBuf = Buffer.alloc(padding);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcOff = (y * width + x) * 4;
      buf[off++] = rgba[srcOff + 2]; // B
      buf[off++] = rgba[srcOff + 1]; // G
      buf[off++] = rgba[srcOff + 0]; // R
      // skip alpha
    }
    if (padding > 0) {
      padBuf.copy(buf, off);
      off += padding;
    }
  }

  return buf;
}

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("Error: sharp is not installed. Run 'npm install' first.");
    process.exit(1);
  }

  const compactLogoSvg = readFileSync(resolve(ICONS_DIR, "app-icon-small.svg"));
  const detailedLogoSvg = readFileSync(resolve(ICONS_DIR, "app-icon.svg"));

  // Resize logo to fit in banners
  const logo40 = await renderBrandIcon(sharp, compactLogoSvg, 40);
  const logo80 = await renderBrandIcon(sharp, detailedLogoSvg, 80);
  const logo96 = await renderBrandIcon(sharp, detailedLogoSvg, 96);

  async function makeBmp(svgString, filename, w, h) {
    const pngBuf = await sharp(Buffer.from(svgString)).png().toBuffer();
    const { data } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bmp = encodeBmp24(data, w, h);
    writeFileSync(resolve(ICONS_DIR, filename), bmp);
    console.log(`  ${filename} (${w}×${h})`);
  }

  // ── WiX banner: 493×58 ──
  await makeBmp(`<svg width="493" height="58" xmlns="http://www.w3.org/2000/svg">
    <rect width="493" height="58" fill="#1e293b"/>
    <image href="data:image/png;base64,${logo40.toString("base64")}" x="12" y="9" width="40" height="40"/>
    <text x="62" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="bold" fill="#e2e8f0">OverlayTrans</text>
  </svg>`, "installer-header.bmp", 493, 58);

  // ── WiX dialog: 493×312 ──
  await makeBmp(`<svg width="493" height="312" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="dialog-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#312e81"/>
      </linearGradient>
    </defs>
    <rect width="493" height="312" fill="url(#dialog-bg)"/>
    <image href="data:image/png;base64,${logo96.toString("base64")}" x="44" y="72" width="96" height="96"/>
    <text x="44" y="205" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="bold" fill="#f8fafc">OverlayTrans</text>
    <text x="44" y="231" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#cbd5e1">Immersive AI Screen Translator</text>
  </svg>`, "installer-dialog.bmp", 493, 312);

  // ── NSIS header: 150×57 ──
  await makeBmp(`<svg width="150" height="57" xmlns="http://www.w3.org/2000/svg">
    <rect width="150" height="57" fill="#1e293b"/>
    <image href="data:image/png;base64,${logo40.toString("base64")}" x="8" y="9" width="40" height="40"/>
    <text x="55" y="28" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="bold" fill="#e2e8f0">Overlay</text>
    <text x="55" y="44" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="bold" fill="#e2e8f0">Trans</text>
  </svg>`, "installer-header-nsis.bmp", 150, 57);

  // ── NSIS sidebar: 164×314 ──
  await makeBmp(`<svg width="164" height="314" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="164" height="314" fill="url(#bg)"/>
    <image href="data:image/png;base64,${logo80.toString("base64")}" x="42" y="80" width="80" height="80"/>
    <text x="82" y="190" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="bold" fill="#e2e8f0" text-anchor="middle">OverlayTrans</text>
    <text x="82" y="210" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">AI Screen Translator</text>
  </svg>`, "installer-sidebar.bmp", 164, 314);

  console.log("\nDone. Installer assets generated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
