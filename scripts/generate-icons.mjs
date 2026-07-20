/** Generate every platform icon from the approved Kyberagerie no-hex masters. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTWORK_TRIM_PADDING_RATIO,
  PLATFORM_ARTWORK_FILL,
  SMALL_PLATFORM_ARTWORK_FILL,
  renderBrandIcon,
  renderPlatformIcon,
} from "./lib/render-brand-icon.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = resolve(ROOT, "src-tauri", "icons");
const PUBLIC_DIR = resolve(ROOT, "public", "icons");
const DETAILED_PATH = resolve(ICONS_DIR, "app-icon.svg");
const COMPACT_PATH = resolve(ICONS_DIR, "app-icon-small.svg");
const MONO_LIGHT_COMPACT_PATH = resolve(
  ROOT,
  "src",
  "assets",
  "brand",
  "chameleon-mono-light-compact.svg",
);
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const COMPACT_SIZES = new Set([16, 24, 30, 32, 44, 48]);
const WINDOWS_NAMES = new Map([
  [30, "Square30x30Logo.png"],
  [44, "Square44x44Logo.png"],
  [71, "Square71x71Logo.png"],
  [89, "Square89x89Logo.png"],
  [107, "Square107x107Logo.png"],
  [142, "Square142x142Logo.png"],
  [150, "Square150x150Logo.png"],
  [284, "Square284x284Logo.png"],
  [310, "Square310x310Logo.png"],
]);

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Encode RGBA pixels as a classic 32-bit ICO DIB entry (BITMAPINFOHEADER +
 * bottom-up BGRA rows + 1-bit AND mask). Windows only reliably renders
 * PNG-compressed entries at 256×256; smaller sizes must stay DIB or title-bar
 * and installer icons render clipped.
 */
function encodeIcoDib(rgba, width, height) {
  const xorSize = width * 4 * height;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andSize = andRowBytes * height;
  const buf = Buffer.alloc(40 + xorSize + andSize);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(width, 4);
  buf.writeInt32LE(height * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize + andSize, 20);

  let off = 40;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      buf[off] = rgba[src + 2];
      buf[off + 1] = rgba[src + 1];
      buf[off + 2] = rgba[src];
      buf[off + 3] = rgba[src + 3];
      off += 4;
    }
  }
  // AND mask stays all-zero: 32-bit entries carry opacity in the alpha channel.
  return buf;
}

async function buildIco(sharp, images) {
  // Largest entry first: tauri-codegen embeds entries[0] as the runtime
  // window/tray icon, so a leading 16 px entry would blur every taskbar icon.
  const entries = await Promise.all(
    [...images.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(async ([size, png]) => {
        if (size === 256) return { size, data: png };
        const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { size, data: encodeIcoDib(data, size, size) };
      }),
  );
  const headerSize = 6;
  const directorySize = entries.length * 16;
  const ico = Buffer.alloc(
    headerSize + directorySize + entries.reduce((total, entry) => total + entry.data.length, 0),
  );
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(entries.length, 4);

  let dataOffset = headerSize + directorySize;
  let writeOffset = dataOffset;
  entries.forEach((entry, index) => {
    const offset = headerSize + index * 16;
    const dimension = entry.size === 256 ? 0 : entry.size;
    ico.writeUInt8(dimension, offset);
    ico.writeUInt8(dimension, offset + 1);
    ico.writeUInt16LE(0, offset + 2);
    ico.writeUInt16LE(1, offset + 4);
    ico.writeUInt16LE(32, offset + 6);
    ico.writeUInt32LE(entry.data.length, offset + 8);
    ico.writeUInt32LE(dataOffset, offset + 12);
    entry.data.copy(ico, writeOffset);
    dataOffset += entry.data.length;
    writeOffset += entry.data.length;
  });
  return ico;
}

async function main() {
  const sharp = (await import("sharp")).default;
  const detailed = readFileSync(DETAILED_PATH);
  const compact = readFileSync(COMPACT_PATH);
  const monoLightCompact = readFileSync(MONO_LIGHT_COMPACT_PATH);

  console.log("Generating full-platform icons from the approved no-hex master...");
  const generatedInputDir = resolve(ROOT, "src-tauri", "target", "brand-assets");
  mkdirSync(generatedInputDir, { recursive: true });
  const generatedInput = resolve(generatedInputDir, "platform-icon-input.png");
  writeFileSync(generatedInput, await renderBrandIcon(sharp, detailed, 1024));
  const tauriCli = resolve(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const generated = spawnSync(process.execPath, [tauriCli, "icon", generatedInput], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (generated.status !== 0) {
    throw new Error(`tauri icon failed with exit code ${generated.status ?? "unknown"}`);
  }

  // Any genuinely small platform PNG uses the compact master for legibility.
  for (const path of walkFiles(ICONS_DIR).filter((file) => file.endsWith(".png"))) {
    const metadata = await sharp(path).metadata();
    if (metadata.width && metadata.height && Math.max(metadata.width, metadata.height) < 64) {
      const png = await renderPlatformIcon(
        sharp,
        compact,
        metadata.width,
        monoLightCompact,
      );
      writeFileSync(path, png);
    }
  }

  const icoImages = new Map();
  for (const size of [16, 24, 30, 32, 44, 48, 64, 71, 89, 107, 128, 142, 150, 256, 284, 310, 512]) {
    const source = COMPACT_SIZES.has(size) ? compact : detailed;
    const png = await renderPlatformIcon(sharp, source, size, monoLightCompact);
    if ([16, 24, 32, 48, 64, 128, 256, 512].includes(size)) {
      writeFileSync(resolve(ICONS_DIR, `${size}x${size}.png`), png);
    }
    const windowsName = WINDOWS_NAMES.get(size);
    if (windowsName) writeFileSync(resolve(ICONS_DIR, windowsName), png);
    if (ICO_SIZES.includes(size)) icoImages.set(size, png);
  }

  writeFileSync(resolve(ICONS_DIR, "icon.png"), await renderBrandIcon(sharp, detailed, 512));
  writeFileSync(resolve(ICONS_DIR, "128x128@2x.png"), await renderBrandIcon(sharp, detailed, 256));
  writeFileSync(resolve(ICONS_DIR, "icon.ico"), await buildIco(sharp, icoImages));

  // StoreLogo is visually tiny even though its canvas can be 50 px.
  const storeMetadata = await sharp(resolve(ICONS_DIR, "StoreLogo.png")).metadata();
  writeFileSync(
    resolve(ICONS_DIR, "StoreLogo.png"),
    await renderPlatformIcon(sharp, compact, storeMetadata.width, monoLightCompact),
  );

  for (const size of [16, 32, 256]) {
    const source = size < 64 ? compact : detailed;
    writeFileSync(
      resolve(PUBLIC_DIR, `${size}x${size}.png`),
      await renderPlatformIcon(sharp, source, size, monoLightCompact),
    );
  }

  const manifestPaths = [
    DETAILED_PATH,
    COMPACT_PATH,
    resolve(ICONS_DIR, "icon.icns"),
    resolve(ICONS_DIR, "icon.ico"),
    resolve(ICONS_DIR, "StoreLogo.png"),
    ...walkFiles(resolve(ICONS_DIR, "android")),
    ...walkFiles(resolve(ICONS_DIR, "ios")),
  ].filter((path) => statSync(path).isFile());
  const manifest = {
    schema_version: 1,
    source_variant: "approved-kyberagerie-chameleon-no-hex",
    detailed_sha256: sha256(DETAILED_PATH),
    compact_sha256: sha256(COMPACT_PATH),
    mono_light_compact_sha256: sha256(MONO_LIGHT_COMPACT_PATH),
    platform_artwork_fill: PLATFORM_ARTWORK_FILL,
    small_platform_artwork_fill: SMALL_PLATFORM_ARTWORK_FILL,
    artwork_trim_padding_ratio: ARTWORK_TRIM_PADDING_RATIO,
    files: Object.fromEntries(
      manifestPaths.sort().map((path) => [relative(ROOT, path).replaceAll("\\", "/"), sha256(path)]),
    ),
  };
  writeFileSync(
    resolve(ICONS_DIR, "BRAND_ASSET_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log("Brand icons and manifest generated successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
