// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCargoAboutVersion,
  assertCargoDenyVersion,
  assertCoveragePartition,
  cargoAboutArguments,
  cargoDenyArguments,
  cargoMetadataArguments,
  cargoVendorArguments,
  collectRegistryFallbackRecords,
  collectRustRuntimeGraph,
  extractCargoAboutRecords,
  indexVendoredChecksumManifests,
  renderRustLicenseReport,
  validateLicensePolicy,
} from "./generate-rust-licenses.mjs";

const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
const roots = [];
const packageId = (name, version, source = REGISTRY) => `${source}#${name}@${version}`;
const digest = (value) => createHash("sha256").update(value).digest("hex");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function cargoAboutFixture() {
  const alpha = packageId("alpha", "1.0.0");
  const zeta = packageId("zeta", "2.0.0");
  return {
    licenses: [
      {
        name: "MIT License",
        id: "MIT",
        text: "MIT body\n",
        source_path: "C:\\Users\\private-user\\.cargo\\registry\\MIT",
        used_by: [{ crate: { id: zeta, name: "zeta", version: "2.0.0", source: REGISTRY } }],
      },
      {
        name: "Apache License 2.0",
        id: "Apache-2.0",
        text: "Apache body\n",
        source_path: "/tmp/private-user/apache",
        used_by: [
          { crate: { id: alpha, name: "alpha", version: "1.0.0", source: REGISTRY } },
          { crate: { id: zeta, name: "zeta", version: "2.0.0", source: REGISTRY } },
        ],
      },
    ],
  };
}

function metadataFixture() {
  const root = "path+file:///repo/src-tauri#overlay-trans@3.0.4";
  const runtimeV1 = packageId("same", "1.0.0");
  const runtimeV2 = packageId("same", "2.0.0");
  const derive = packageId("derive", "1.0.0");
  const syn = packageId("syn", "2.0.0");
  const build = packageId("build-helper", "1.0.0");
  const dev = packageId("test-helper", "1.0.0");
  const packages = [
    { id: root, name: "overlay-trans", version: "3.0.4", source: null, targets: [{ kind: ["bin"] }] },
    { id: runtimeV1, name: "same", version: "1.0.0", source: REGISTRY, targets: [{ kind: ["lib"] }] },
    { id: runtimeV2, name: "same", version: "2.0.0", source: REGISTRY, targets: [{ kind: ["lib"] }] },
    { id: derive, name: "derive", version: "1.0.0", source: REGISTRY, targets: [{ kind: ["proc-macro"] }] },
    { id: syn, name: "syn", version: "2.0.0", source: REGISTRY, targets: [{ kind: ["lib"] }] },
    { id: build, name: "build-helper", version: "1.0.0", source: REGISTRY, targets: [{ kind: ["lib"] }] },
    { id: dev, name: "test-helper", version: "1.0.0", source: REGISTRY, targets: [{ kind: ["lib"] }] },
  ];
  const nodes = [
    {
      id: root,
      dependencies: [runtimeV1, runtimeV2, derive, build, dev],
      deps: [
        { pkg: runtimeV1, dep_kinds: [{ kind: null, target: null }] },
        { pkg: runtimeV2, dep_kinds: [{ kind: null, target: null }] },
        { pkg: derive, dep_kinds: [{ kind: null, target: null }] },
        { pkg: build, dep_kinds: [{ kind: "build", target: null }] },
        { pkg: dev, dep_kinds: [{ kind: "dev", target: null }] },
      ],
    },
    { id: runtimeV1, dependencies: [], deps: [] },
    { id: runtimeV2, dependencies: [], deps: [] },
    { id: derive, dependencies: [syn], deps: [{ pkg: syn, dep_kinds: [{ kind: null, target: null }] }] },
    { id: syn, dependencies: [], deps: [] },
    { id: build, dependencies: [], deps: [] },
    { id: dev, dependencies: [], deps: [] },
  ];
  return {
    packages,
    resolve: { root, nodes },
    workspace_members: [root],
    workspace_default_members: [root],
    workspace_root: "D:/repo/src-tauri",
    target_directory: "D:/repo/src-tauri/target",
    version: 1,
    metadata: null,
  };
}

function registryFixture({ source = REGISTRY, legalFiles = { "LICENSE": "license body\n", "NOTICE.txt": "notice body\n" } } = {}) {
  const root = mkdtempSync(join(tmpdir(), "overlaytrans-rust-license-test-"));
  roots.push(root);
  const crateRoot = join(root, "exact-crate");
  mkdirSync(crateRoot, { recursive: true });
  const id = source ? packageId("exact-crate", "1.2.3", source) : "path+file:///tmp/exact-crate#1.2.3";
  const manifestPath = join(crateRoot, "Cargo.toml");
  writeFileSync(manifestPath, "[package]\nname = \"exact-crate\"\nversion = \"1.2.3\"\n");
  const files = {};
  for (const [name, body] of Object.entries(legalFiles)) {
    writeFileSync(join(crateRoot, name), body);
    files[name] = digest(body);
  }
  const archiveChecksum = "a".repeat(64);
  const checksumPath = join(crateRoot, ".cargo-checksum.json");
  writeFileSync(
    checksumPath,
    JSON.stringify({ files, package: archiveChecksum }),
  );
  const cargoLockText = [
    "version = 4",
    "",
    "[[package]]",
    'name = "exact-crate"',
    'version = "1.2.3"',
    source ? `source = "${source}"` : "",
    `checksum = "${archiveChecksum}"`,
    "",
  ].filter(Boolean).join("\n");
  const pkg = {
    id,
    name: "exact-crate",
    version: "1.2.3",
    source,
    license: "MIT",
    manifest_path: manifestPath,
    targets: [{ kind: ["lib"] }],
  };
  return { root, id, pkg, cargoLockText, crateRoot, checksumPath, archiveChecksum };
}

function checksumManifests(fixture) {
  return new Map([[fixture.archiveChecksum, fixture.checksumPath]]);
}

describe("Rust runtime license report", () => {
  it("pins the exact cargo-about and cargo-deny versions", () => {
    expect(() => assertCargoAboutVersion("cargo-about 0.8.4\n")).not.toThrow();
    expect(() => assertCargoAboutVersion("cargo-about 0.9.1\n")).toThrow(/0\.8\.4/);
    expect(() => assertCargoDenyVersion("cargo-deny 0.20.2\n")).not.toThrow();
    expect(() => assertCargoDenyVersion("cargo-deny 0.20.1\n")).toThrow(/0\.20\.2/);
  });

  it("uses real locked/offline Windows tool arguments", () => {
    const about = cargoAboutArguments({ root: "D:/repo", jsonPath: "D:/temp/about.json" });
    expect(about).toEqual(expect.arrayContaining(["--output-file", "D:/temp/about.json", "--locked", "--offline", "--fail"]));
    expect(cargoMetadataArguments({ root: "D:/repo" })).toEqual(expect.arrayContaining([
      "--locked", "--filter-platform", "x86_64-pc-windows-msvc",
    ]));
    expect(cargoVendorArguments({ root: "D:/repo", vendorRoot: "D:/temp/vendor" }))
      .toEqual(expect.arrayContaining([
        "vendor", "--locked", "--offline", "--versioned-dirs", "D:/temp/vendor",
      ]));
    expect(cargoDenyArguments({ root: "D:/repo", metadataPath: "D:/temp/metadata.json" }))
      .toEqual(expect.arrayContaining([
        "--metadata-path", "D:/temp/metadata.json", "--target", "x86_64-pc-windows-msvc",
        "--locked", "--offline", "check", "licenses",
      ]));
  });

  it("traverses only normal resolve edges and preserves same-name Package IDs", () => {
    const graph = collectRustRuntimeGraph(metadataFixture());
    expect([...graph.runtimeIds]).toEqual([
      packageId("same", "1.0.0"),
      packageId("same", "2.0.0"),
    ]);
    expect(graph.filteredMetadata.packages.map((pkg) => pkg.id)).toEqual([
      "path+file:///repo/src-tauri#overlay-trans@3.0.4",
      packageId("same", "1.0.0"),
      packageId("same", "2.0.0"),
    ]);
    expect(graph.filteredMetadata.resolve.nodes[0].dependencies).toEqual([
      packageId("same", "1.0.0"),
      packageId("same", "2.0.0"),
    ]);
  });

  it("partitions cargo-about omissions and rejects missing, overlap and extra IDs", () => {
    const one = packageId("same", "1.0.0");
    const two = packageId("same", "2.0.0");
    const extra = packageId("extra", "1.0.0");
    expect(() => assertCoveragePartition({
      runtimeIds: new Set([one, two]), cargoAboutIds: new Set([two]), fallbackIds: new Set([one]),
    })).not.toThrow();
    expect(() => assertCoveragePartition({
      runtimeIds: new Set([one, two]), cargoAboutIds: new Set([two]), fallbackIds: new Set(),
    })).toThrow(/missing/i);
    expect(() => assertCoveragePartition({
      runtimeIds: new Set([one, two]), cargoAboutIds: new Set([two]), fallbackIds: new Set([two, one]),
    })).toThrow(/overlap/i);
    expect(() => assertCoveragePartition({
      runtimeIds: new Set([one, two]), cargoAboutIds: new Set([two, extra]), fallbackIds: new Set([one]),
    })).toThrow(/extra/i);
  });

  it("extracts cargo-about coverage by full Package ID", () => {
    const runtimeIds = new Set([packageId("alpha", "1.0.0"), packageId("zeta", "2.0.0")]);
    const records = extractCargoAboutRecords(cargoAboutFixture(), runtimeIds);
    expect(records.map((record) => record.id)).toEqual([...runtimeIds]);
    expect(records.every((record) => record.coverage === "cargo-about")).toBe(true);
  });

  it("rejects unknown cargo-about licenses and missing full text", () => {
    const fixture = cargoAboutFixture();
    const runtimeIds = new Set([packageId("alpha", "1.0.0"), packageId("zeta", "2.0.0")]);
    fixture.licenses[0].id = "NOASSERTION";
    expect(() => extractCargoAboutRecords(fixture, runtimeIds)).toThrow(/unknown license/i);

    const missingText = cargoAboutFixture();
    missingText.licenses[0].text = "";
    expect(() => extractCargoAboutRecords(missingText, runtimeIds)).toThrow(/missing full license text/i);
  });

  it("verifies Cargo.lock, archive and every legal-file checksum", () => {
    const fixture = registryFixture();
    const manifests = checksumManifests(fixture);
    const records = collectRegistryFallbackRecords({
      packagesById: new Map([[fixture.id, fixture.pkg]]),
      fallbackIds: new Set([fixture.id]),
      cargoLockText: fixture.cargoLockText,
      checksumManifestsByPackageChecksum: manifests,
    });
    expect(records[0].documents.map((doc) => [doc.spdx, doc.sha256, doc.name])).toEqual(
      [...records[0].documents]
        .sort((left, right) => left.spdx.localeCompare(right.spdx)
          || left.sha256.localeCompare(right.sha256)
          || left.name.localeCompare(right.name))
        .map((doc) => [doc.spdx, doc.sha256, doc.name]),
    );
    expect(new Set(records[0].documents.map((doc) => doc.name))).toEqual(
      new Set(["LICENSE", "NOTICE.txt"]),
    );
    expect(records[0].coverage).toBe("registry-fallback");

    const checksum = JSON.parse(readFileSync(join(fixture.crateRoot, ".cargo-checksum.json"), "utf8"));
    checksum.package = "b".repeat(64);
    writeFileSync(join(fixture.crateRoot, ".cargo-checksum.json"), JSON.stringify(checksum));
    expect(() => collectRegistryFallbackRecords({
      packagesById: new Map([[fixture.id, fixture.pkg]]), fallbackIds: new Set([fixture.id]),
      cargoLockText: fixture.cargoLockText,
      checksumManifestsByPackageChecksum: manifests,
    })).toThrow(/package checksum/i);
  });

  it("indexes cargo-vendored checksum manifests by the locked package checksum", () => {
    const fixture = registryFixture();
    const vendorRoot = join(fixture.root, "vendor");
    const vendored = join(vendorRoot, "not-a-guessed-package-path");
    mkdirSync(vendored, { recursive: true });
    writeFileSync(
      join(vendored, ".cargo-checksum.json"),
      readFileSync(fixture.checksumPath),
    );
    expect(indexVendoredChecksumManifests(vendorRoot)).toEqual(
      new Map([[fixture.archiveChecksum, join(vendored, ".cargo-checksum.json")]]),
    );
  });

  it("rejects a changed legal file and a crate with no LICENSE/COPYING/NOTICE", () => {
    const changed = registryFixture();
    writeFileSync(join(changed.crateRoot, "LICENSE"), "tampered\n");
    expect(() => collectRegistryFallbackRecords({
      packagesById: new Map([[changed.id, changed.pkg]]), fallbackIds: new Set([changed.id]),
      cargoLockText: changed.cargoLockText,
      checksumManifestsByPackageChecksum: checksumManifests(changed),
    })).toThrow(/file checksum/i);

    const missing = registryFixture({ legalFiles: {} });
    expect(() => collectRegistryFallbackRecords({
      packagesById: new Map([[missing.id, missing.pkg]]), fallbackIds: new Set([missing.id]),
      cargoLockText: missing.cargoLockText,
      checksumManifestsByPackageChecksum: checksumManifests(missing),
    })).toThrow(/LICENSE|COPYING|NOTICE/i);
  });

  it("rejects git/path fallback and cargo-deny unaccepted SPDX results", () => {
    const pathFixture = registryFixture({ source: null });
    expect(() => collectRegistryFallbackRecords({
      packagesById: new Map([[pathFixture.id, pathFixture.pkg]]),
      fallbackIds: new Set([pathFixture.id]), cargoLockText: pathFixture.cargoLockText,
    })).toThrow(/git|path|clarification/i);

    expect(() => validateLicensePolicy({
      root: "D:/repo",
      metadataPath: "D:/temp/metadata.json",
      runCommand: () => ({ status: 1, stdout: "", stderr: "GPL-3.0 is not allowed" }),
    })).toThrow(/GPL-3\.0|license policy/i);
  });

  it("pins local-only cargo-about config and keeps transitive dependencies", () => {
    const about = readFileSync(join(process.cwd(), "src-tauri/about.toml"), "utf8");
    expect(about).toMatch(/targets\s*=\s*\["x86_64-pc-windows-msvc"\]/);
    expect(about).toMatch(/ignore-dev-dependencies\s*=\s*true/);
    expect(about).toMatch(/ignore-build-dependencies\s*=\s*true/);
    expect(about).toMatch(/no-clearly-defined\s*=\s*true/);
    expect(about).not.toMatch(/ignore-transitive-dependencies\s*=\s*true/);
  });

  it("sorts stable full IDs and omits paths, usernames and timestamps", () => {
    const records = extractCargoAboutRecords(
      cargoAboutFixture(),
      new Set([packageId("alpha", "1.0.0"), packageId("zeta", "2.0.0")]),
    );
    const first = renderRustLicenseReport(records);
    const second = renderRustLicenseReport([...records].reverse());
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(first.indexOf("alpha@1.0.0")).toBeLessThan(first.indexOf("zeta@2.0.0"));
    expect(first).not.toMatch(/source_path|private-user|C:\\Users|\/tmp\/|generated at|timestamp/i);
  });
});
