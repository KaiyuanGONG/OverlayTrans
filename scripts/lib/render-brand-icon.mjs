export const PLATFORM_ARTWORK_FILL = 0.76;
export const SMALL_PLATFORM_ARTWORK_FILL = 0.82;
export const ARTWORK_TRIM_PADDING_RATIO = 0.08;
export const PLATE_INSET_RATIO = 0.03;
export const PLATE_RADIUS_RATIO = 0.22;

/** Dark rounded plate that keeps the mark legible on light desktops. */
function platePng(sharp, size, style = "large") {
  const inset = Math.max(1, Math.round(size * PLATE_INSET_RATIO));
  const side = size - inset * 2;
  const radius = Math.max(1, Math.round(size * PLATE_RADIUS_RATIO));
  const colors = style === "small" ? ["#6366F1", "#4338CA"] : ["#1E293B", "#0F172A"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}" fill="url(#plate)"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Remove only the source canvas whitespace, then restore transparent breathing
 * room before any resize. Resizing a zero-margin trim clips the extremal
 * antialiasing on the approved chameleon's nose and curled tail.
 */
async function rasterizeWithSafeTrim(sharp, source, rasterSize) {
  // Sharp may reorder trim/resize operations within one pipeline. Keeping them
  // together made the non-square 1.24:1 chameleon get trimmed first and then
  // forced through resize's default `cover`, which cropped both horizontal
  // ends. Materialize the contained square before starting the trim pipeline.
  const square = await sharp(source)
    .resize(rasterSize, rasterSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const { data: trimmed, info } = await sharp(square)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const padding = Math.max(
    8,
    Math.ceil(Math.max(info.width, info.height) * ARTWORK_TRIM_PADDING_RATIO),
  );
  return sharp(trimmed)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** Render SVG artwork centered on the dark plate inside a square icon canvas. */
export async function renderBrandIcon(
  sharp,
  source,
  size,
  fill = PLATFORM_ARTWORK_FILL,
) {
  const rasterSize = Math.max(1024, size * 4);
  const trimmed = await rasterizeWithSafeTrim(sharp, source, rasterSize);
  const artworkSize = Math.max(1, Math.round(size * fill));
  const { data: artwork, info } = await sharp(trimmed)
    .resize(artworkSize, artworkSize, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: await platePng(sharp, size), left: 0, top: 0 },
      {
        input: artwork,
        left: Math.floor((size - info.width) / 2),
        top: Math.floor((size - info.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/** Windows small-icon composition: approved compact geometry, white on indigo. */
export async function renderPlatformIcon(sharp, source, size, monochromeSource) {
  if (size >= 64) return renderBrandIcon(sharp, source, size);
  const monochrome = monochromeSource ?? Buffer.from(
    source.toString("utf8").replaceAll("url(#signal)", "#F8FAFC"),
  );
  const rasterSize = Math.max(1024, size * 4);
  const trimmed = await rasterizeWithSafeTrim(sharp, monochrome, rasterSize);
  const artworkSize = Math.max(1, Math.round(size * SMALL_PLATFORM_ARTWORK_FILL));
  const { data: artwork, info } = await sharp(trimmed)
    .resize(artworkSize, artworkSize, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: await platePng(sharp, size, "small"), left: 0, top: 0 },
      {
        input: artwork,
        left: Math.floor((size - info.width) / 2),
        top: Math.floor((size - info.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}
