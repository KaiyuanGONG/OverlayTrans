#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CARGO_ABOUT_VERSION = "0.8.4";
export const CARGO_DENY_VERSION = "0.20.2";
const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
const REGISTRY_SOURCE = /^registry\+/;
const LEGAL_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeBody(text) {
  return `${text.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertVersion(output, tool, version) {
  const actual = output.trim();
  const expected = `${tool} ${version}`;
  if (actual !== expected) {
    throw new Error(`${tool} ${version} is required; found: ${actual || "none"}`);
  }
}

export function assertCargoAboutVersion(output) {
  assertVersion(output, "cargo-about", CARGO_ABOUT_VERSION);
}

export function assertCargoDenyVersion(output) {
  assertVersion(output, "cargo-deny", CARGO_DENY_VERSION);
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function runChecked(command, args, options = {}) {
  const result = commandResult(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function cargoAboutArguments({ root, jsonPath }) {
  return [
    "about",
    "generate",
    "--format",
    "json",
    "--output-file",
    jsonPath,
    "--manifest-path",
    join(root, "src-tauri", "Cargo.toml"),
    "--config",
    join(root, "src-tauri", "about.toml"),
    "--locked",
    "--offline",
    "--fail",
  ];
}

export function cargoMetadataArguments({ root }) {
  return [
    "metadata",
    "--format-version",
    "1",
    "--manifest-path",
    join(root, "src-tauri", "Cargo.toml"),
    "--locked",
    "--filter-platform",
    WINDOWS_TARGET,
  ];
}

export function cargoVendorArguments({ root, vendorRoot }) {
  return [
    "vendor",
    "--locked",
    "--offline",
    "--versioned-dirs",
    "--manifest-path",
    join(root, "src-tauri", "Cargo.toml"),
    vendorRoot,
  ];
}

export function cargoDenyArguments({ root, metadataPath }) {
  return [
    "deny",
    "--manifest-path",
    join(root, "src-tauri", "Cargo.toml"),
    "--metadata-path",
    metadataPath,
    "--config",
    join(root, "src-tauri", "deny.toml"),
    "--target",
    WINDOWS_TARGET,
    "--locked",
    "--offline",
    "--exclude-dev",
    "check",
    "licenses",
    "--hide-inclusion-graph",
  ];
}

function runtimeCapable(pkg) {
  const runtimeKinds = new Set(["bin", "lib", "rlib", "dylib", "cdylib", "staticlib"]);
  return pkg?.targets?.some((target) => target.kind?.some((kind) => runtimeKinds.has(kind)));
}

export function collectRustRuntimeGraph(metadata) {
  if (!metadata?.resolve?.root || !Array.isArray(metadata.resolve.nodes)) {
    throw new Error("Cargo metadata is missing a resolved root graph");
  }
  const packagesById = new Map((metadata.packages ?? []).map((pkg) => [pkg.id, pkg]));
  const nodesById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const rootId = metadata.resolve.root;
  const rootPackage = packagesById.get(rootId);
  if (!rootPackage || rootPackage.name !== "overlay-trans" || !(metadata.workspace_members ?? []).includes(rootId)) {
    throw new Error("Cargo metadata root is not the OverlayTrans workspace package");
  }

  const includedIds = new Set([rootId]);
  const runtimeIds = new Set();
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const node = nodesById.get(currentId);
    if (!node) throw new Error(`Cargo metadata is missing resolve node ${currentId}`);
    for (const dependency of node.deps ?? []) {
      const normal = (dependency.dep_kinds ?? []).some((kind) => kind.kind === null);
      if (!normal || includedIds.has(dependency.pkg)) continue;
      const pkg = packagesById.get(dependency.pkg);
      if (!pkg) throw new Error(`Cargo metadata is missing package ${dependency.pkg}`);
      if (!runtimeCapable(pkg)) continue;
      includedIds.add(dependency.pkg);
      runtimeIds.add(dependency.pkg);
      queue.push(dependency.pkg);
    }
  }

  const orderedIds = [rootId, ...[...runtimeIds].sort(compareText)];
  const filteredNodes = orderedIds.map((id) => {
    const node = nodesById.get(id);
    const deps = (node.deps ?? []).filter((dependency) =>
      includedIds.has(dependency.pkg)
      && (dependency.dep_kinds ?? []).some((kind) => kind.kind === null));
    return {
      ...node,
      dependencies: deps.map((dependency) => dependency.pkg),
      deps,
    };
  });
  const filteredMetadata = {
    ...metadata,
    packages: orderedIds.map((id) => packagesById.get(id)),
    workspace_members: [rootId],
    workspace_default_members: [rootId],
    resolve: { ...metadata.resolve, root: rootId, nodes: filteredNodes },
  };

  return {
    rootId,
    runtimeIds: new Set([...runtimeIds].sort(compareText)),
    packagesById: new Map([...runtimeIds].sort(compareText).map((id) => [id, packagesById.get(id)])),
    filteredMetadata,
  };
}

function sortedDocuments(documents) {
  return [...documents].sort(
    (left, right) => compareText(left.spdx, right.spdx)
      || compareText(left.sha256, right.sha256)
      || compareText(left.name, right.name),
  );
}

export function extractCargoAboutRecords(data, runtimeIds) {
  if (!data || !Array.isArray(data.licenses)) {
    throw new Error("cargo-about returned malformed JSON without licenses");
  }
  const components = new Map();
  for (const license of data.licenses) {
    const spdx = typeof license.id === "string" ? license.id.trim() : "";
    if (!spdx || /^(?:NOASSERTION|UNKNOWN|NONE)$/i.test(spdx)) {
      throw new Error(`Unknown license in cargo-about output: ${spdx || "missing SPDX"}`);
    }
    if (typeof license.text !== "string" || !license.text.trim()) {
      throw new Error(`Missing full license text for ${spdx}`);
    }
    const body = normalizeBody(license.text);
    const bodySha256 = sha256(body);
    for (const use of license.used_by ?? []) {
      const crate = use?.crate;
      if (!crate || typeof crate.id !== "string" || typeof crate.name !== "string"
          || typeof crate.version !== "string") {
        throw new Error(`Malformed cargo-about crate record for ${spdx}`);
      }
      if (!runtimeIds.has(crate.id)) continue;
      const component = components.get(crate.id) ?? {
        id: crate.id,
        name: crate.name,
        version: crate.version,
        source: crate.source,
        coverage: "cargo-about",
        documents: [],
      };
      const documentKey = `${spdx}\0${bodySha256}`;
      if (!component.documents.some((document) => document.key === documentKey)) {
        component.documents.push({
          key: documentKey,
          name: license.name || spdx,
          spdx,
          sha256: bodySha256,
          body,
        });
      }
      components.set(crate.id, component);
    }
  }
  return [...components.values()]
    .map((component) => ({ ...component, documents: sortedDocuments(component.documents) }))
    .sort((left, right) => compareText(left.id, right.id));
}

function parseTomlStringField(block, field) {
  const match = block.match(new RegExp(`^${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, "m"));
  return match ? JSON.parse(match[1]) : undefined;
}

function parseCargoLock(cargoLockText) {
  const packages = new Map();
  for (const block of cargoLockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = parseTomlStringField(block, "name");
    const version = parseTomlStringField(block, "version");
    const source = parseTomlStringField(block, "source");
    const checksum = parseTomlStringField(block, "checksum");
    if (!name || !version || !source) continue;
    packages.set(`${source}#${name}@${version}`, { name, version, source, checksum });
  }
  return packages;
}

export function indexVendoredChecksumManifests(vendorRoot) {
  const manifests = new Map();
  for (const entry of readdirSync(vendorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const checksumPath = join(vendorRoot, entry.name, ".cargo-checksum.json");
    if (!existsSync(checksumPath)) continue;
    const checksum = JSON.parse(readFileSync(checksumPath, "utf8"));
    if (typeof checksum.package !== "string" || !SHA256.test(checksum.package)) {
      throw new Error(`Invalid vendored package checksum manifest: ${checksumPath}`);
    }
    if (manifests.has(checksum.package)) {
      throw new Error(`Duplicate vendored package checksum: ${checksum.package}`);
    }
    manifests.set(checksum.package, checksumPath);
  }
  return manifests;
}

export function collectRegistryFallbackRecords({
  packagesById,
  fallbackIds,
  cargoLockText,
  checksumManifestsByPackageChecksum,
}) {
  const lockedPackages = parseCargoLock(cargoLockText);
  const records = [];
  for (const id of [...fallbackIds].sort(compareText)) {
    const pkg = packagesById.get(id);
    if (!pkg) throw new Error(`Fallback Package ID is not in filtered metadata: ${id}`);
    if (typeof pkg.source !== "string" || !REGISTRY_SOURCE.test(pkg.source)) {
      throw new Error(`Git/path dependency ${id} requires an explicit checksum-bound clarification`);
    }
    const locked = lockedPackages.get(id);
    if (!locked || typeof locked.checksum !== "string" || !SHA256.test(locked.checksum)) {
      throw new Error(`Cargo.lock checksum missing for ${id}`);
    }
    if (typeof pkg.manifest_path !== "string" || !existsSync(pkg.manifest_path)) {
      throw new Error(`Cargo metadata manifest_path is unavailable for ${id}`);
    }
    const packageRoot = dirname(pkg.manifest_path);
    const checksumPath = checksumManifestsByPackageChecksum?.get(locked.checksum)
      ?? join(packageRoot, ".cargo-checksum.json");
    if (!existsSync(checksumPath)) throw new Error(`Registry checksum metadata missing for ${id}`);
    const checksum = JSON.parse(readFileSync(checksumPath, "utf8"));
    if (checksum.package !== locked.checksum) {
      throw new Error(`Registry package checksum mismatch for ${id}`);
    }

    const legalFiles = readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LEGAL_FILE.test(entry.name))
      .sort((left, right) => compareText(left.name, right.name));
    if (legalFiles.length === 0) {
      throw new Error(`Registry crate ${id} is missing LICENSE*, COPYING*, or NOTICE*`);
    }
    if (typeof pkg.license !== "string" || !pkg.license.trim()) {
      throw new Error(`Registry crate ${id} has an unknown license expression`);
    }

    const documents = legalFiles.map((entry) => {
      const bytes = readFileSync(join(packageRoot, entry.name));
      const fileSha256 = sha256(bytes);
      const expected = checksum.files?.[entry.name];
      if (expected !== fileSha256) {
        throw new Error(`Registry legal file checksum mismatch for ${id}: ${entry.name}`);
      }
      const body = normalizeBody(bytes.toString("utf8"));
      if (!body.trim()) throw new Error(`Empty legal document for ${id}: ${entry.name}`);
      return {
        name: entry.name,
        spdx: pkg.license.trim(),
        sha256: fileSha256,
        body,
      };
    });
    records.push({
      id,
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      coverage: "registry-fallback",
      documents: sortedDocuments(documents),
    });
  }
  return records;
}

export function assertCoveragePartition({ runtimeIds, cargoAboutIds, fallbackIds }) {
  const overlap = [...cargoAboutIds].filter((id) => fallbackIds.has(id)).sort(compareText);
  if (overlap.length > 0) throw new Error(`License coverage overlap: ${overlap.join(", ")}`);
  const union = new Set([...cargoAboutIds, ...fallbackIds]);
  const extra = [...union].filter((id) => !runtimeIds.has(id)).sort(compareText);
  if (extra.length > 0) throw new Error(`Extra license coverage Package IDs: ${extra.join(", ")}`);
  const missing = [...runtimeIds].filter((id) => !union.has(id)).sort(compareText);
  if (missing.length > 0) throw new Error(`Missing license coverage Package IDs: ${missing.join(", ")}`);
}

export function validateLicensePolicy({ root, metadataPath, runCommand = commandResult }) {
  const args = cargoDenyArguments({ root, metadataPath });
  const result = runCommand("cargo", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo-deny license policy failed:\n${result.stderr || result.stdout}`);
  }
}

export function renderRustLicenseReport(records) {
  const components = [...records]
    .map((record) => ({ ...record, documents: sortedDocuments(record.documents) }))
    .sort(
      (left, right) => compareText(left.name, right.name)
        || compareText(left.version, right.version)
        || compareText(left.source ?? "", right.source ?? "")
        || compareText(left.documents[0].spdx, right.documents[0].spdx)
        || compareText(left.documents[0].sha256, right.documents[0].sha256),
    );
  const sections = components.map((component) => {
    const documents = component.documents.map((document) => [
      `Document: ${document.name}`,
      `SPDX: ${document.spdx}`,
      `SHA-256: ${document.sha256}`,
      "",
      document.body.trimEnd(),
    ].join("\n")).join("\n\n");
    return [
      "=".repeat(80),
      `${component.name}@${component.version}`,
      `Cargo Package ID: ${component.id}`,
      `Coverage: ${component.coverage}`,
      "",
      documents,
    ].join("\n");
  });
  return [
    "OverlayTrans Rust Runtime Third-Party Licenses",
    `Target: ${WINDOWS_TARGET}`,
    `Crates: ${components.length}`,
    "",
    ...sections,
    "",
  ].join("\n");
}

export function generateRustLicenseReport({ root, outputPath }) {
  assertCargoAboutVersion(runChecked("cargo", ["about", "--version"]));
  assertCargoDenyVersion(runChecked("cargo", ["deny", "--version"]));
  const metadata = JSON.parse(runChecked("cargo", cargoMetadataArguments({ root }), { cwd: root }));
  const graph = collectRustRuntimeGraph(metadata);
  const tempRoot = mkdtempSync(join(tmpdir(), "overlaytrans-rust-licenses-"));
  let report;
  try {
    const filteredMetadataPath = join(tempRoot, "windows-runtime-metadata.json");
    const cargoAboutPath = join(tempRoot, "cargo-about.json");
    writeFileSync(filteredMetadataPath, JSON.stringify(graph.filteredMetadata), "utf8");
    validateLicensePolicy({ root, metadataPath: filteredMetadataPath });
    runChecked("cargo", cargoAboutArguments({ root, jsonPath: cargoAboutPath }), { cwd: root });

    const cargoAboutRecords = extractCargoAboutRecords(
      JSON.parse(readFileSync(cargoAboutPath, "utf8")),
      graph.runtimeIds,
    );
    const cargoAboutIds = new Set(cargoAboutRecords.map((record) => record.id));
    const fallbackIds = new Set([...graph.runtimeIds].filter((id) => !cargoAboutIds.has(id)));
    const vendorRoot = join(tempRoot, "vendor");
    let checksumManifestsByPackageChecksum = new Map();
    if (fallbackIds.size > 0) {
      runChecked("cargo", cargoVendorArguments({ root, vendorRoot }), { cwd: root });
      checksumManifestsByPackageChecksum = indexVendoredChecksumManifests(vendorRoot);
    }
    const fallbackRecords = collectRegistryFallbackRecords({
      packagesById: graph.packagesById,
      fallbackIds,
      cargoLockText: readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"),
      checksumManifestsByPackageChecksum,
    });
    assertCoveragePartition({
      runtimeIds: graph.runtimeIds,
      cargoAboutIds,
      fallbackIds: new Set(fallbackRecords.map((record) => record.id)),
    });
    report = renderRustLicenseReport([...cargoAboutRecords, ...fallbackRecords]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, "utf8");
  return report;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = dirname(dirname(scriptPath));
  const outputPath = process.env.OVERLAYTRANS_RUST_LICENSE_OUTPUT
    ?? join(root, "src-tauri", "licenses", "RUST_THIRD_PARTY_LICENSES.txt");
  generateRustLicenseReport({ root, outputPath });
  console.log(`Rust license report written: ${outputPath}`);
}
