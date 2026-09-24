# Icons

The icons and installer images in this folder are generated from the approved brand masters
(`app-icon.svg`, `app-icon-small.svg`); the platform outputs are pinned by hash in
`BRAND_ASSET_MANIFEST.json`. Do not run `tauri icon` directly or hand-edit the outputs;
regenerate and validate from the repository root:

```powershell
node scripts/generate-icons.mjs
node scripts/generate-installer-assets.mjs
node scripts/validate-brand-assets.mjs
```

Provenance, sizing strategy and ICO layout: [`BRAND_PROVENANCE.md`](BRAND_PROVENANCE.md).
The brand assets are not covered by the MIT License — see [`TRADEMARKS.md`](../../TRADEMARKS.md).
