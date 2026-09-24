# OverlayTrans application icon provenance

- Identity: Kyberagerie Chameleon V2, approved no-hex variant
- Source classification: generated, approved production asset
- Artwork approval date: 2026-07-13
- Export completion date: 2026-07-18
- Paint: fixed signal gradient (`#22D3EE` → `#6366F1` → `#A855F7`)
- Source description: approved Kyberagerie Chameleon no-hex export

No machine-specific source path is required to verify or regenerate the committed assets. The committed SVG masters are byte-identical copies of the approved exports and are the reproducible source of truth:

| Master | Role | SHA-256 |
|---|---|---|
| `app-icon.svg` | detailed artwork for 64 px and above | `3feaebd548d74f32eb809a788002d221dde1cf05e9fd80e0ac12b74854395347` |
| `app-icon-small.svg` | compact artwork for sizes below 64 px | `cdea15e77ab0d5fa9169904a9e55956fe205c0e4a015abe60a7e9e4efb5ee750` |
| `../../src/assets/brand/chameleon-mono-light-compact.svg` | white compact artwork for Windows small icons | `c3aad5411bd35feab5a28ca6f040b90389d9df5b1e80d239e76c1e72c34ce256` |

## Asset strategy

- `scripts/generate-icons.mjs` renders the detailed no-hex master onto the platform plate at 1024 px and feeds that PNG to `tauri icon`, which produces the full Android, iOS, ICNS and platform icon set.
- Small raster assets and `StoreLogo.png` are overwritten from the compact no-hex master for legibility.
- `icon.ico` contains compact 16/24/32/48 px entries and detailed 64/128/256 px entries, ordered largest-first. The 256 px entry stays PNG-compressed; every smaller entry is a classic 32-bit DIB because Windows title bars and NSIS render sub-256 PNG entries clipped, and tauri-codegen embeds the first entry as the runtime window/tray icon.
- `BRAND_ASSET_MANIFEST.json` pins hashes for ICNS, Android, iOS, Store and ICO outputs from the same generation run.
- In-app Onboarding and About surfaces import `src/assets/brand/chameleon-signal.svg`, whose bytes match the detailed master.

## Platform canvas composition

The approved SVG masters and animal geometry remain byte-for-byte unchanged. Platform derivatives rasterize the complete square source first, then trim and restore an 8% transparent safety margin in a separate image pipeline. This preserves the approved artwork's approximately 1.24:1 visible aspect ratio and prevents a square `cover` resize from clipping the nose and tail. The complete mark is recentered on a dark rounded plate (`#1E293B` → `#0F172A`) at 64 px and above; small Windows entries use the approved white compact master on an indigo plate. These packaging compositions do not alter the canonical no-hex SVGs.

## Regeneration and validation

From the repository root:

```powershell
node scripts/generate-icons.mjs
node scripts/generate-installer-assets.mjs
node scripts/validate-brand-assets.mjs
```

The validator is non-mutating. It verifies the approved master hashes, key PNG dimensions and transparency, compact Store logo, seven-entry mixed ICO, 24-bit installer BMPs, and the Android/iOS/ICNS manifest.
