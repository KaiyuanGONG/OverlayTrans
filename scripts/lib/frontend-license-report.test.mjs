// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectFrontendPackages,
  renderFrontendLicenseReport,
} from "./frontend-license-report.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "overlaytrans-frontend-license-test-"));
  roots.push(root);
  return root;
}

function addPackage(root, installPath, { name, version, license = "MIT", notice = false }) {
  const packageRoot = join(root, ...installPath.split("/"));
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name, version, license }, null, 2)}\n`,
  );
  writeFileSync(join(packageRoot, "LICENSE.md"), `${name} license body\n`);
  if (notice) {
    writeFileSync(join(packageRoot, "NOTICE"), `${name} Apache notice\n`);
  }
  writeFileSync(join(packageRoot, "dist", "index.js"), "export {};\n");
  writeFileSync(join(packageRoot, "dist", "style.css"), ".fixture {}\n");
  writeFileSync(join(packageRoot, "dist", "icon.svg"), "<svg/>\n");
  return packageRoot;
}

function lockEntry(version, marker) {
  return {
    version,
    resolved: `https://registry.npmjs.org/fixture/-/fixture-${version}.tgz`,
    integrity: `sha512-${Buffer.from(marker.repeat(64)).toString("base64")}`,
  };
}

function setupRuntimeGraph() {
  const root = fixtureRoot();
  const packages = [
    ["node_modules/react", "react", "18.3.1", true],
    ["node_modules/parent/node_modules/zustand", "zustand", "5.0.11", false],
    ["node_modules/lucide-react", "lucide-react", "1.25.0", false],
    ["node_modules/@tauri-apps/api", "@tauri-apps/api", "2.10.1", false],
    ["node_modules/css-runtime", "css-runtime", "1.0.0", false],
    ["node_modules/asset-runtime", "asset-runtime", "1.0.0", false],
    ["node_modules/vite", "vite", "6.0.3", false],
    ["node_modules/vitest", "vitest", "4.1.10", false],
    ["node_modules/typescript", "typescript", "5.6.3", false],
    ["node_modules/@types/react", "@types/react", "18.3.28", false],
    ["node_modules/sharp", "sharp", "0.33.5", false],
  ];
  const lockPackages = { "": { name: "fixture", version: "1.0.0" } };
  const packageRoots = {};

  packages.forEach(([installPath, name, version, notice], index) => {
    packageRoots[name] = addPackage(root, installPath, { name, version, notice });
    lockPackages[installPath] = lockEntry(version, String.fromCharCode(65 + index));
  });

  const bundle = {
    "main-ABC123.js": {
      type: "chunk",
      fileName: "main-ABC123.js",
      modules: {
        [`${packageRoots.react}/dist/index.js?commonjs-entry`]: {},
        [`${packageRoots.zustand}/dist/index.js`]: {},
        [`\0${packageRoots.vite}/dist/index.js?commonjs-proxy`]: {},
      },
      imports: [],
      dynamicImports: ["lazy-DEF456.js"],
      viteMetadata: {
        importedCss: new Set(["style-GHI789.css"]),
        importedAssets: new Set(["icon-JKL012.svg"]),
      },
    },
    "lazy-DEF456.js": {
      type: "chunk",
      fileName: "lazy-DEF456.js",
      modules: {
        [`${packageRoots["lucide-react"]}/dist/index.js`]: {},
        [`${packageRoots["@tauri-apps/api"]}/dist/index.js`]: {},
      },
      imports: [],
      dynamicImports: [],
      viteMetadata: { importedCss: new Set(), importedAssets: new Set() },
    },
    "style-GHI789.css": {
      type: "asset",
      fileName: "style-GHI789.css",
      originalFileNames: [`${packageRoots["css-runtime"]}/dist/style.css`],
      source: ".fixture {}",
    },
    "icon-JKL012.svg": {
      type: "asset",
      fileName: "icon-JKL012.svg",
      originalFileNames: [`${packageRoots["asset-runtime"]}/dist/icon.svg`],
      source: "<svg/>",
    },
  };

  return { root, lock: { lockfileVersion: 3, packages: lockPackages }, bundle };
}

describe("frontend runtime license report", () => {
  it("collects every final runtime chunk, CSS, asset and NOTICE while excluding dev packages", () => {
    const { root, lock, bundle } = setupRuntimeGraph();
    const packages = collectFrontendPackages({ root, lock, bundle });
    const names = packages.map((entry) => entry.name);

    expect(names).toEqual([
      "@tauri-apps/api",
      "asset-runtime",
      "css-runtime",
      "lucide-react",
      "react",
      "zustand",
    ]);
    expect(names).not.toEqual(expect.arrayContaining([
      "vite",
      "vitest",
      "typescript",
      "@types/react",
      "sharp",
    ]));
    const reactDocuments = packages.find((entry) => entry.name === "react").documents;
    expect(new Set(reactDocuments.map((doc) => doc.name))).toEqual(new Set(["LICENSE.md", "NOTICE"]));
    expect(reactDocuments.map((doc) => doc.sha256)).toEqual(
      [...reactDocuments].map((doc) => doc.sha256).sort(),
    );
  });

  it("requires package-lock version and integrity to match the nearest package", () => {
    const { root, lock, bundle } = setupRuntimeGraph();
    lock.packages["node_modules/react"].version = "0.0.0";
    expect(() => collectFrontendPackages({ root, lock, bundle })).toThrow(/locked version/i);

    lock.packages["node_modules/react"].version = "18.3.1";
    delete lock.packages["node_modules/react"].integrity;
    expect(() => collectFrontendPackages({ root, lock, bundle })).toThrow(/integrity/i);
  });

  it("rejects runtime packages with an unknown license or no legal text", () => {
    const unknown = setupRuntimeGraph();
    writeFileSync(
      join(unknown.root, "node_modules", "react", "package.json"),
      `${JSON.stringify({ name: "react", version: "18.3.1", license: "unknown" }, null, 2)}\n`,
    );
    expect(() => collectFrontendPackages(unknown)).toThrow(/unknown license/i);

    const missing = setupRuntimeGraph();
    rmSync(join(missing.root, "node_modules", "react", "LICENSE.md"));
    rmSync(join(missing.root, "node_modules", "react", "NOTICE"));
    expect(() => collectFrontendPackages(missing)).toThrow(/missing LICENSE/i);
  });

  it("sorts deterministically and never emits paths or chunk hashes", () => {
    const { root, lock, bundle } = setupRuntimeGraph();
    const first = renderFrontendLicenseReport(collectFrontendPackages({ root, lock, bundle }));
    const second = renderFrontendLicenseReport(collectFrontendPackages({ root, lock, bundle }));

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(first).not.toContain(root);
    expect(first).not.toMatch(/(?:ABC123|DEF456|GHI789|JKL012)/);
    expect(first).not.toMatch(/source_path|generated at|timestamp/i);
  });
});
