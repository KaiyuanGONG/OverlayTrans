#!/usr/bin/env node
/**
 * Build preparation script: downloads and extracts llama.cpp runtime for sidecar packaging.
 *
 * This script:
 * 1. Downloads the fixed llama.cpp release zip
 * 2. Verifies SHA-256
 * 3. Extracts llama-server.exe and required DLLs
 * 4. Places them in src-tauri/binaries/ with correct target-triple naming
 *
 * Run: node scripts/prepare-sidecar.mjs
 *
 * Locked to llama.cpp b10068 (2026-07-18) per handoff §7.1
 */

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Locked manifest (§7.1) ──
const LLAMA_CPP = {
  repo: 'ggml-org/llama.cpp',
  release: 'b10068',
  asset: 'llama-b10068-bin-win-cpu-x64.zip',
  sha256: '01d5f30876acfb4a0be59396710f450213495c7181d8fbcce2fad045835ceb89',
  downloadUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10068/llama-b10068-bin-win-cpu-x64.zip',
  licenseUrl: 'https://raw.githubusercontent.com/ggml-org/llama.cpp/b10068/LICENSE',
  licenseSha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
};

const TARGET_TRIPLE = 'x86_64-pc-windows-msvc';
const BINARIES_DIR = join(ROOT, 'src-tauri', 'binaries');
const TEMP_DIR = join(ROOT, 'src-tauri', 'target', 'sidecar-temp');

// The b10068 Windows CPU archive uses a small launcher plus implementation,
// common, core and CPU-dispatch DLLs. These names guard against silently
// packaging an incomplete or structurally different release.
const REQUIRED_FILES = [
  'llama-server.exe',
  'llama-server-impl.dll',
  'llama-common.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'ggml.dll',
  'llama.dll',
  'libomp140.x86_64.dll',
];

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  // Content-Length describes compressed transfer bytes when Content-Encoding
  // is present, so it cannot be compared with the decoded fetch body size.
  const total = response.headers.get('content-encoding')
    ? 0
    : parseInt(response.headers.get('content-length') || '0', 10);
  let downloaded = 0;

  const fileStream = createWriteStream(dest);
  const fileFinished = once(fileStream, 'finish');
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\r  ${pct}% (${(downloaded / 1048576).toFixed(1)} MB)`);
    }
  }
  fileStream.end();
  await fileFinished;
  console.log('\n  Download complete.');
}

function verifySha256(filePath, expected) {
  console.log(`Verifying SHA-256...`);
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch!\n  Expected: ${expected}\n  Actual:   ${actual}`);
  }
  console.log('  SHA-256 verified OK.');
}

async function extractFiles(zipPath, destDir) {
  console.log(`Extracting to ${destDir}...`);
  mkdirSync(destDir, { recursive: true });

  // The locked runtime is Windows-only, so use the bsdtar bundled with
  // supported Windows versions instead of adding a build-only npm package.
  const result = spawnSync('tar.exe', ['-xf', zipPath, '-C', destDir], {
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`Unable to start tar.exe: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Archive extraction failed: ${result.stderr || result.stdout}`);
  }
}

function findExtractedFile(root, fileName) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findExtractedFile(path, fileName);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return path;
    }
  }
  return undefined;
}

function collectExtractedDlls(root, result = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectExtractedDlls(path, result);
    } else if (entry.name.toLowerCase().endsWith('.dll')) {
      result.push(path);
    }
  }
  return result;
}

function prepareRuntimeFiles(extractedDir, licensePath) {
  console.log('Preparing files for Tauri packaging...');
  for (const file of REQUIRED_FILES) {
    const src = findExtractedFile(extractedDir, file);
    if (!src) {
      throw new Error(`Required runtime file missing from archive: ${file}`);
    }
  }

  // Do not destroy a previously valid runtime until every new input has been
  // downloaded, verified and extracted successfully.
  if (existsSync(BINARIES_DIR)) {
    rmSync(BINARIES_DIR, { recursive: true });
  }
  mkdirSync(BINARIES_DIR, { recursive: true });

  const serverSrc = findExtractedFile(extractedDir, 'llama-server.exe');
  const serverName = `llama-server-${TARGET_TRIPLE}.exe`;
  copyFileSync(serverSrc, join(BINARIES_DIR, serverName));
  console.log(`  llama-server.exe -> ${serverName}`);

  // DLL names must remain unchanged: the Windows loader resolves these exact
  // names next to llama-server.exe. Copy all release DLLs so CPU dispatch can
  // select the correct implementation for the user's processor.
  const dlls = collectExtractedDlls(extractedDir);
  for (const dll of dlls) {
    const name = dll.split(/[\\/]/).pop();
    copyFileSync(dll, join(BINARIES_DIR, name));
  }
  console.log(`  ${dlls.length} runtime DLLs copied with original names`);

  copyFileSync(licensePath, join(BINARIES_DIR, 'llama-server-LICENSE.txt'));
  console.log('  pinned llama.cpp LICENSE copied');
}

async function main() {
  console.log('=== OverlayTrans Sidecar Preparation ===');
  console.log(`Runtime: llama.cpp ${LLAMA_CPP.release}`);
  console.log(`Target: ${TARGET_TRIPLE}`);
  console.log('');

  // Clean temp
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true });
  }
  mkdirSync(TEMP_DIR, { recursive: true });

  const zipPath = join(TEMP_DIR, LLAMA_CPP.asset);
  const licensePath = join(TEMP_DIR, 'LICENSE');

  let completed = false;
  try {
    // Step 1: Download
    await downloadFile(LLAMA_CPP.downloadUrl, zipPath);

    // Step 2: Verify SHA-256
    verifySha256(zipPath, LLAMA_CPP.sha256);

    // The binary archive does not contain the upstream license, so fetch it
    // from the same pinned release and verify its locked digest.
    await downloadFile(LLAMA_CPP.licenseUrl, licensePath);
    verifySha256(licensePath, LLAMA_CPP.licenseSha256);

    // Step 3: Extract
    const extractedDir = join(TEMP_DIR, 'extracted');
    await extractFiles(zipPath, extractedDir);

    // Step 4: prepare the external binary, DLL resources and license
    prepareRuntimeFiles(extractedDir, licensePath);

    console.log('');
    console.log('=== Sidecar preparation complete ===');
    console.log(`Files placed in: ${BINARIES_DIR}`);
    console.log('You can now run: npm run tauri build');
    completed = true;

  } finally {
    // Keep failed downloads/extractions for diagnostics and retry without
    // hiding the actual archive layout behind a generic missing-file error.
    if (completed && existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true });
    } else if (existsSync(TEMP_DIR)) {
      console.error(`Temporary files retained for diagnostics: ${TEMP_DIR}`);
    }
  }
}

main().catch((err) => {
  console.error('Sidecar preparation failed:', err);
  process.exit(1);
});
