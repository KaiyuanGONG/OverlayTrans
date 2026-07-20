/** Fail release gates on likely real API keys without ever printing them. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = [
  "dist",
  "src",
  "src-tauri/src",
  "src-tauri/target/release/overlay-trans.exe",
  "src-tauri/target/release/bundle",
  "package.json",
  "src-tauri/tauri.conf.json",
].map((path) => resolve(ROOT, path));
const SK_PATTERN = /sk-[A-Za-z0-9_-]{20,}/g;

function files(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    files(resolve(path, entry.name)),
  );
}

const findings = [];
for (const path of SCAN_ROOTS.flatMap(files)) {
  const content = readFileSync(path).toString("latin1");
  for (const match of content.matchAll(SK_PATTERN)) {
    findings.push({ path: relative(ROOT, path), offset: match.index ?? 0 });
  }
}

if (findings.length > 0) {
  console.error(`Release secret scan failed with ${findings.length} possible key(s):`);
  for (const finding of findings) console.error(`  ${finding.path} @ byte ${finding.offset}`);
  process.exit(1);
}
console.log("Release secret scan passed (no real-length sk- patterns found). ");
