import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LEGAL_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeBody(text) {
  return `${text.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}

function normalizeModuleId(moduleId) {
  if (typeof moduleId !== "string" || moduleId.length === 0 || moduleId.startsWith("\0")) {
    return undefined;
  }
  if (/^(?:virtual:|vite:|\/@id\/)/.test(moduleId)) {
    return undefined;
  }

  let clean = moduleId;
  const suffix = clean.search(/[?#]/);
  if (suffix >= 0) clean = clean.slice(0, suffix);
  if (clean.startsWith("/@fs/")) clean = clean.slice(4);
  if (clean.startsWith("file:")) clean = fileURLToPath(clean);
  return isAbsolute(clean) ? resolve(clean) : undefined;
}

function nearestPackage(modulePath) {
  if (!modulePath || !existsSync(modulePath)) return undefined;
  let cursor = statSync(modulePath).isDirectory() ? modulePath : dirname(modulePath);

  while (true) {
    const manifestPath = join(cursor, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string" && typeof manifest.version === "string") {
        return { root: cursor, manifest };
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function packageLockPath(root, packageRoot) {
  const lockPath = relative(resolve(root), resolve(packageRoot)).split(sep).join("/");
  if (!lockPath || lockPath.startsWith("../") || !lockPath.split("/").includes("node_modules")) {
    return undefined;
  }
  return lockPath;
}

function readLegalDocuments(packageRoot) {
  const documents = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LEGAL_FILE.test(entry.name))
    .map((entry) => {
      const body = normalizeBody(readFileSync(join(packageRoot, entry.name), "utf8"));
      if (!body.trim()) throw new Error(`Empty license document: ${entry.name}`);
      return { name: entry.name, sha256: sha256(body), body };
    })
    .sort((left, right) => compareText(left.sha256, right.sha256) || compareText(left.name, right.name));

  if (documents.length === 0) {
    throw new Error("Package is missing LICENSE*, COPYING*, or NOTICE* text");
  }
  return documents;
}

function validateLicenseExpression(value, packageName) {
  if (typeof value !== "string" || !value.trim() || /^(?:unknown|unlicensed)$/i.test(value.trim())) {
    throw new Error(`Unknown license for ${packageName}`);
  }
  return value.trim();
}

function collectSourceIds(bundle) {
  const ids = new Set();
  const outputs = new Map(Object.values(bundle).map((output) => [output.fileName, output]));

  function addChunk(chunk) {
    Object.keys(chunk.modules ?? {}).forEach((id) => ids.add(id));
    for (const fileName of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      const imported = outputs.get(fileName);
      if (imported?.type === "chunk") {
        Object.keys(imported.modules ?? {}).forEach((id) => ids.add(id));
      }
    }

    const metadata = chunk.viteMetadata;
    for (const fileName of [
      ...(metadata?.importedCss ?? []),
      ...(metadata?.importedAssets ?? []),
    ]) {
      const asset = outputs.get(fileName);
      if (asset?.type !== "asset") continue;
      const originalNames = asset.originalFileNames
        ?? (asset.originalFileName ? [asset.originalFileName] : []);
      originalNames.forEach((id) => ids.add(id));
    }
  }

  Object.values(bundle)
    .filter((output) => output.type === "chunk")
    .forEach(addChunk);
  return ids;
}

export function collectFrontendPackages({ root, lock, bundle }) {
  if (!lock || lock.lockfileVersion !== 3 || typeof lock.packages !== "object") {
    throw new Error("Expected npm package-lock.json lockfileVersion 3");
  }

  const packages = new Map();
  for (const rawId of collectSourceIds(bundle)) {
    const modulePath = normalizeModuleId(rawId);
    const found = nearestPackage(modulePath);
    if (!found) continue;
    const installPath = packageLockPath(root, found.root);
    if (!installPath) continue;

    const locked = lock.packages[installPath];
    if (!locked) throw new Error(`No package-lock entry for ${found.manifest.name}`);
    if (locked.version !== found.manifest.version) {
      throw new Error(
        `Locked version mismatch for ${found.manifest.name}: ${locked.version} != ${found.manifest.version}`,
      );
    }
    if (typeof locked.integrity !== "string" || !INTEGRITY.test(locked.integrity)) {
      throw new Error(`Missing or invalid integrity for ${found.manifest.name}`);
    }

    const entry = {
      name: found.manifest.name,
      version: found.manifest.version,
      spdx: validateLicenseExpression(found.manifest.license, found.manifest.name),
      integrity: locked.integrity,
      documents: readLegalDocuments(found.root),
    };
    const key = `${entry.name}\0${entry.version}\0${entry.spdx}\0${entry.integrity}`;
    const previous = packages.get(key);
    if (previous && JSON.stringify(previous.documents) !== JSON.stringify(entry.documents)) {
      throw new Error(`Conflicting license texts for duplicate package ${entry.name}@${entry.version}`);
    }
    packages.set(key, entry);
  }

  return [...packages.values()].sort(
    (left, right) => compareText(left.name, right.name)
      || compareText(left.version, right.version)
      || compareText(left.spdx, right.spdx)
      || compareText(left.documents[0].sha256, right.documents[0].sha256),
  );
}

export function renderFrontendLicenseReport(packages) {
  const sections = packages.map((entry) => {
    const documents = [...entry.documents]
      .sort((left, right) => compareText(left.sha256, right.sha256) || compareText(left.name, right.name))
      .map((document) => [
        `Document: ${document.name}`,
        `SHA-256: ${document.sha256}`,
        "",
        document.body.trimEnd(),
      ].join("\n"))
      .join("\n\n");
    return [
      "=".repeat(80),
      `${entry.name}@${entry.version}`,
      `SPDX: ${entry.spdx}`,
      `Integrity: ${entry.integrity}`,
      "",
      documents,
    ].join("\n");
  });

  return [
    "OverlayTrans Frontend Runtime Third-Party Licenses",
    "Target: Windows x86_64-pc-windows-msvc",
    `Packages: ${packages.length}`,
    "",
    ...sections,
    "",
  ].join("\n");
}

export function createFrontendLicensePlugin({ root, lockPath, outputPath }) {
  return {
    name: "overlaytrans-frontend-license-report",
    apply: "build",
    generateBundle(_options, bundle) {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const packages = collectFrontendPackages({ root, lock, bundle });
      if (packages.length === 0) throw new Error("No frontend runtime packages found in final chunks");
      const report = renderFrontendLicenseReport(packages);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, report, "utf8");
    },
  };
}
