/** Non-mutating validation for the approved no-hex brand asset set. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTWORK_TRIM_PADDING_RATIO,
  PLATFORM_ARTWORK_FILL,
  SMALL_PLATFORM_ARTWORK_FILL,
  renderPlatformIcon,
} from "./lib/render-brand-icon.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = resolve(ROOT, "src-tauri", "icons");
const EXPECTED_DETAILED = "3feaebd548d74f32eb809a788002d221dde1cf05e9fd80e0ac12b74854395347";
const EXPECTED_COMPACT = "cdea15e77ab0d5fa9169904a9e55956fe205c0e4a015abe60a7e9e4efb5ee750";
const EXPECTED_MONO_LIGHT_COMPACT = "c3aad5411bd35feab5a28ca6f040b90389d9df5b1e80d239e76c1e72c34ce256";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  const bytes = readFileSync(path);
  const input = [".svg", ".xml"].includes(extname(path).toLowerCase())
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n?/g, "\n"), "utf8")
    : bytes;
  return createHash("sha256").update(input).digest("hex");
}

async function visibleBounds(sharp, input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert(maxX >= minX && maxY >= minY, "image has no visible pixels");
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function assertMasterAspectRatio(sharp, path, label) {
  const contained = await sharp(path)
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const bounds = await visibleBounds(sharp, contained);
  const ratio = bounds.width / bounds.height;
  assert(
    ratio >= 1.2 && ratio <= 1.3,
    `${label} visible aspect ratio ${ratio.toFixed(3)} must preserve the complete 1.24:1 artwork`,
  );
}

function readBmp(path, width, height) {
  const data = readFileSync(path);
  assert(data.toString("ascii", 0, 2) === "BM", `${path} is not a BMP`);
  assert(data.readInt32LE(18) === width, `${path} width must be ${width}`);
  assert(Math.abs(data.readInt32LE(22)) === height, `${path} height must be ${height}`);
  assert(data.readUInt16LE(28) === 24, `${path} must be 24-bit`);
}

function readIcoEntries(path) {
  const data = readFileSync(path);
  assert(data.readUInt16LE(0) === 0 && data.readUInt16LE(2) === 1, "icon.ico header is invalid");
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const value = data.readUInt8(offset);
    const payloadOffset = data.readUInt32LE(offset + 12);
    const isPng =
      data.readUInt32LE(payloadOffset) === 0x474e5089 /* \x89PNG little-endian */;
    const isDib = data.readUInt32LE(payloadOffset) === 40; /* BITMAPINFOHEADER */
    const payloadLength = data.readUInt32LE(offset + 8);
    return {
      size: value === 0 ? 256 : value,
      isPng,
      isDib,
      payload: data.subarray(payloadOffset, payloadOffset + payloadLength),
    };
  });
}

async function decodeIcoEntry(sharp, entry) {
  if (entry.isPng) {
    return sharp(entry.payload).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  }
  assert(entry.isDib, `icon.ico ${entry.size} px payload is not decodable`);
  const width = entry.payload.readInt32LE(4);
  const height = entry.payload.readInt32LE(8) / 2;
  assert(width === entry.size && height === entry.size, `icon.ico ${entry.size} px DIB dimensions mismatch`);
  const rgba = Buffer.alloc(width * height * 4);
  let source = 40;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      rgba[target] = entry.payload[source + 2];
      rgba[target + 1] = entry.payload[source + 1];
      rgba[target + 2] = entry.payload[source];
      rgba[target + 3] = entry.payload[source + 3];
      source += 4;
    }
  }
  return { data: rgba, info: { width, height } };
}

function assertIcoFramePixels(entry, data, info) {
  let visible = 0;
  let white = 0;
  let indigo = 0;
  let color = 0;
  let markMinX = info.width;
  let markMinY = info.height;
  let markMaxX = -1;
  let markMaxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const [r, g, b, a] = data.subarray(offset, offset + 4);
      if (a === 0) continue;
      visible += 1;
      // At 16 px the approved white strokes are heavily antialiased into the
      // indigo plate, so require a neutral high-luminance pixel rather than a
      // nearly pure white one.
      const isWhiteMark = r > 170 && g > 170 && b > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 50;
      const isSignalMark = Math.max(r, g, b) - Math.min(r, g, b) > 45 && Math.max(r, g, b) > 140;
      if (isWhiteMark) white += 1;
      if (b > r * 1.25 && b > g * 1.08 && b > 100) indigo += 1;
      if (isSignalMark) color += 1;
      if (entry.size <= 48 ? isWhiteMark : isSignalMark) {
        markMinX = Math.min(markMinX, x);
        markMinY = Math.min(markMinY, y);
        markMaxX = Math.max(markMaxX, x);
        markMaxY = Math.max(markMaxY, y);
      }
      assert(
        x > 0 && y > 0 && x < info.width - 1 && y < info.height - 1,
        `icon.ico ${entry.size} px visible pixels touch the canvas edge`,
      );
    }
  }
  assert(visible > info.width * info.height * 0.45, `icon.ico ${entry.size} px has too little visible area`);
  if (entry.size <= 48) {
    assert(white >= Math.max(1, visible * 0.006), `icon.ico ${entry.size} px lacks the white compact mark`);
    assert(indigo > visible * 0.35, `icon.ico ${entry.size} px lacks the indigo accent plate`);
  } else {
    assert(color > visible * 0.02, `icon.ico ${entry.size} px lacks the approved signal artwork`);
  }
  const safeMargin = entry.size <= 48
    ? Math.max(2, Math.floor(entry.size * 0.12))
    : Math.max(8, Math.floor(entry.size * 0.15));
  const actualMargin = Math.min(
    markMinX,
    markMinY,
    info.width - 1 - markMaxX,
    info.height - 1 - markMaxY,
  );
  if (entry.size >= 64) {
    const markWidth = markMaxX - markMinX + 1;
    const markHeight = markMaxY - markMinY + 1;
    const markRatio = markWidth / markHeight;
    assert(
      markRatio >= 1.1 && markRatio <= 1.45,
      `icon.ico ${entry.size} px mark aspect ratio ${markRatio.toFixed(3)} indicates horizontal clipping`,
    );
  }
  assert(
    actualMargin >= safeMargin,
    `icon.ico ${entry.size} px mark margin ${actualMargin}px is below ${safeMargin}px`,
  );
}

async function assertVisibleArtworkFillsCanvas(sharp, path, minimumLongestSide) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert(maxX >= minX && maxY >= minY, `${path} has no visible pixels`);
  const longestSide = Math.max(maxX - minX + 1, maxY - minY + 1);
  assert(
    longestSide / Math.max(info.width, info.height) >= minimumLongestSide,
    `${path} artwork is too small for its canvas`,
  );
}

async function main() {
  const sharp = (await import("sharp")).default;
  const detailedPath = resolve(ICONS, "app-icon.svg");
  const compactPath = resolve(ICONS, "app-icon-small.svg");
  const monoLightCompactPath = resolve(
    ROOT,
    "src",
    "assets",
    "brand",
    "chameleon-mono-light-compact.svg",
  );
  assert(sha256(detailedPath) === EXPECTED_DETAILED, "detailed master SHA-256 mismatch");
  assert(sha256(compactPath) === EXPECTED_COMPACT, "compact master SHA-256 mismatch");
  assert(
    sha256(monoLightCompactPath) === EXPECTED_MONO_LIGHT_COMPACT,
    "mono-light compact master SHA-256 mismatch",
  );
  await assertMasterAspectRatio(sharp, detailedPath, "detailed master");
  await assertMasterAspectRatio(sharp, compactPath, "compact master");

  const pngExpectations = new Map([
    [resolve(ICONS, "32x32.png"), 32],
    [resolve(ICONS, "128x128.png"), 128],
    [resolve(ICONS, "icon.png"), 512],
    [resolve(ROOT, "public", "icons", "16x16.png"), 16],
    [resolve(ROOT, "public", "icons", "32x32.png"), 32],
    [resolve(ROOT, "public", "icons", "256x256.png"), 256],
  ]);
  for (const [path, size] of pngExpectations) {
    const metadata = await sharp(path).metadata();
    assert(metadata.width === size && metadata.height === size, `${path} must be ${size}x${size}`);
    assert(metadata.hasAlpha === true, `${path} must preserve transparency`);
    await assertVisibleArtworkFillsCanvas(sharp, path, 0.78);
  }

  const storePath = resolve(ICONS, "StoreLogo.png");
  const storeMetadata = await sharp(storePath).metadata();
  const expectedStore = await renderPlatformIcon(
    sharp,
    readFileSync(compactPath),
    storeMetadata.width,
    readFileSync(monoLightCompactPath),
  );
  assert(
    createHash("sha256").update(expectedStore).digest("hex") === sha256(storePath),
    "StoreLogo.png must use the compact no-hex master",
  );

  const icoEntries = readIcoEntries(resolve(ICONS, "icon.ico"));
  assert(
    JSON.stringify(icoEntries.map((entry) => entry.size)) ===
      JSON.stringify([256, 128, 64, 48, 32, 24, 16]),
    `icon.ico sizes are invalid: ${icoEntries.map((entry) => entry.size).join(", ")}`,
  );
  for (const entry of icoEntries) {
    if (entry.size === 256) {
      assert(entry.isPng, "icon.ico 256 px entry must be PNG-compressed");
    } else {
      // Windows title bars and NSIS render sub-256 PNG entries clipped.
      assert(entry.isDib, `icon.ico ${entry.size} px entry must be a classic DIB`);
    }
    const decoded = await decodeIcoEntry(sharp, entry);
    assertIcoFramePixels(entry, decoded.data, decoded.info);
  }

  readBmp(resolve(ICONS, "installer-header.bmp"), 493, 58);
  readBmp(resolve(ICONS, "installer-dialog.bmp"), 493, 312);
  readBmp(resolve(ICONS, "installer-header-nsis.bmp"), 150, 57);
  readBmp(resolve(ICONS, "installer-sidebar.bmp"), 164, 314);

  const manifest = JSON.parse(readFileSync(resolve(ICONS, "BRAND_ASSET_MANIFEST.json"), "utf8"));
  assert(manifest.detailed_sha256 === EXPECTED_DETAILED, "manifest detailed hash mismatch");
  assert(manifest.compact_sha256 === EXPECTED_COMPACT, "manifest compact hash mismatch");
  assert(
    manifest.mono_light_compact_sha256 === EXPECTED_MONO_LIGHT_COMPACT,
    "manifest mono-light compact hash mismatch",
  );
  assert(
    manifest.platform_artwork_fill === PLATFORM_ARTWORK_FILL,
    "manifest platform artwork fill mismatch",
  );
  assert(
    manifest.small_platform_artwork_fill === SMALL_PLATFORM_ARTWORK_FILL,
    "manifest small platform artwork fill mismatch",
  );
  assert(
    manifest.artwork_trim_padding_ratio === ARTWORK_TRIM_PADDING_RATIO,
    "manifest artwork trim padding mismatch",
  );
  const paths = Object.keys(manifest.files);
  assert(paths.some((path) => path.endsWith("icon.icns")), "manifest is missing icon.icns");
  assert(paths.some((path) => path.includes("/android/")), "manifest is missing Android icons");
  assert(paths.some((path) => path.includes("/ios/")), "manifest is missing iOS icons");
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    assert(sha256(resolve(ROOT, relativePath)) === expectedHash, `${relativePath} differs from the manifest`);
  }

  const icns = readFileSync(resolve(ICONS, "icon.icns"));
  assert(icns.toString("ascii", 0, 4) === "icns", "icon.icns header is invalid");
  console.log(`Brand asset validation passed (${paths.length} manifested files).`);
}

main().catch((error) => {
  console.error(`Brand asset validation failed: ${error.message}`);
  process.exit(1);
});
