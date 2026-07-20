#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activateStagedDirectory,
  assertAvx2ProbeOutput,
  assertVersionOutput,
  cmakeBuildArguments,
  cmakeConfigureArguments,
  parseAndValidatePeDependencies,
} from "./lib/sidecar-build.mjs";
import { SIDECAR_MANIFEST } from "./lib/sidecar-manifest.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");
const binariesDirectory = join(root, "src-tauri", "binaries");
const temporaryDirectory = join(root, "src-tauri", "target", "sidecar-temp");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function verifySha256(filePath, expected) {
  const actual = sha256(filePath);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
}

function runChecked(command, args, { capture = false, cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw new Error(`Unable to start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const diagnostic = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} exited with status ${result.status}${diagnostic ? `:\n${diagnostic}` : ""}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

async function downloadFile(url, destination) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function findVisualStudioTools() {
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) {
    throw new Error(`Visual Studio locator not found: ${vswhere}`);
  }
  const installationPath = runChecked(vswhere, [
    "-latest",
    "-products", "*",
    "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property", "installationPath",
  ], { capture: true }).trim();
  if (!installationPath) {
    throw new Error("Visual Studio with the MSVC x64 toolchain was not found");
  }
  const cmake = join(
    installationPath,
    "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe",
  );
  const msvcRoot = join(installationPath, "VC", "Tools", "MSVC");
  const versions = readdirSync(msvcRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const msvcVersion = versions.at(-1);
  const dumpbin = msvcVersion
    ? join(msvcRoot, msvcVersion, "bin", "Hostx64", "x64", "dumpbin.exe")
    : undefined;
  if (!existsSync(cmake) || !dumpbin || !existsSync(dumpbin)) {
    throw new Error("Visual Studio CMake or x64 dumpbin.exe was not found");
  }
  return { cmake, dumpbin, installationPath, msvcVersion };
}

function verifyAvx2Host(probeDirectory) {
  const source = join(probeDirectory, "avx2-probe.rs");
  const executable = join(probeDirectory, "avx2-probe.exe");
  writeFileSync(source, [
    "fn main() {",
    "    if std::is_x86_feature_detected!(\"avx2\") {",
    "        println!(\"AVX2_SUPPORTED\");",
    "    } else {",
    "        println!(\"AVX2_UNSUPPORTED\");",
    "        std::process::exit(2);",
    "    }",
    "}",
    "",
  ].join("\n"));
  runChecked("rustc", [source, "-O", "-o", executable]);
  const output = runChecked(executable, [], { capture: true });
  assertAvx2ProbeOutput(output);
}

function extractSource(archive, sourceDirectory) {
  mkdirSync(sourceDirectory, { recursive: true });
  runChecked("tar.exe", [
    "-xf", archive,
    "-C", sourceDirectory,
    "--strip-components", "1",
  ]);
}

function findFile(directory, fileName) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, fileName);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return candidate;
    }
  }
  return undefined;
}

function assertBuildPolicy() {
  if (SIDECAR_MANIFEST.build.definitions.GGML_OPENMP !== "OFF") {
    throw new Error("The locked sidecar build requires GGML_OPENMP=OFF");
  }
  if (SIDECAR_MANIFEST.build.definitions.CMAKE_MSVC_RUNTIME_LIBRARY !== "MultiThreaded") {
    throw new Error("The locked sidecar build requires the static MSVC runtime");
  }
}

function stageCandidate({ builtServer, sourceLicense, stagingDirectory }) {
  mkdirSync(stagingDirectory, { recursive: true });
  const packagedServer = join(
    stagingDirectory,
    `llama-server-${SIDECAR_MANIFEST.targetTriple}.exe`,
  );
  const packagedLicense = join(stagingDirectory, SIDECAR_MANIFEST.license.output);
  copyFileSync(builtServer, packagedServer);
  copyFileSync(sourceLicense, packagedLicense);
  verifySha256(packagedLicense, SIDECAR_MANIFEST.license.sha256);
  return packagedServer;
}

async function main() {
  console.log("=== OverlayTrans static sidecar preparation ===");
  console.log(`Source: ${SIDECAR_MANIFEST.release} ${SIDECAR_MANIFEST.source.revision}`);
  assertBuildPolicy();

  if (existsSync(temporaryDirectory)) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  mkdirSync(temporaryDirectory, { recursive: true });

  const archive = join(temporaryDirectory, SIDECAR_MANIFEST.source.file);
  const sourceDirectory = join(temporaryDirectory, "source");
  const buildDirectory = join(temporaryDirectory, "build");
  const stagingDirectory = join(temporaryDirectory, "binaries-staging");
  const backupDirectory = join(temporaryDirectory, "binaries-backup");
  let completed = false;

  try {
    verifyAvx2Host(temporaryDirectory);
    const tools = findVisualStudioTools();
    console.log(`Visual Studio: ${tools.installationPath}`);
    console.log(`MSVC tools: ${tools.msvcVersion}`);

    await downloadFile(SIDECAR_MANIFEST.source.url, archive);
    verifySha256(archive, SIDECAR_MANIFEST.source.sha256);
    console.log(`Source SHA-256: ${SIDECAR_MANIFEST.source.sha256}`);

    extractSource(archive, sourceDirectory);
    const sourceLicense = join(sourceDirectory, SIDECAR_MANIFEST.license.sourceFile);
    if (!existsSync(sourceLicense)) {
      throw new Error(`Source license is missing: ${sourceLicense}`);
    }
    verifySha256(sourceLicense, SIDECAR_MANIFEST.license.sha256);

    runChecked(tools.cmake, cmakeConfigureArguments({ sourceDir: sourceDirectory, buildDir: buildDirectory }));
    runChecked(tools.cmake, cmakeBuildArguments({ buildDir: buildDirectory }));

    const builtServer = findFile(buildDirectory, SIDECAR_MANIFEST.build.output);
    if (!builtServer) {
      throw new Error(`Built ${SIDECAR_MANIFEST.build.output} was not found`);
    }
    const versionOutput = runChecked(builtServer, ["--version"], { capture: true });
    assertVersionOutput(versionOutput);
    const dependencies = parseAndValidatePeDependencies(
      runChecked(tools.dumpbin, ["/dependents", builtServer], { capture: true }),
    );

    const packagedServer = stageCandidate({ builtServer, sourceLicense, stagingDirectory });
    console.log(`Candidate SHA-256: ${sha256(packagedServer)}`);
    console.log(`Version: ${versionOutput.trim().replace(/\r?\n/g, " | ")}`);
    console.log(`PE dependencies: ${dependencies.join(", ")}`);

    activateStagedDirectory({
      liveDir: binariesDirectory,
      stagingDir: stagingDirectory,
      backupDir: backupDirectory,
    });
    completed = true;
    console.log(`Activated: ${binariesDirectory}`);
  } finally {
    if (completed && existsSync(temporaryDirectory)) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    } else if (existsSync(temporaryDirectory)) {
      console.error(`Candidate files retained for diagnosis: ${temporaryDirectory}`);
    }
  }
}

main().catch((error) => {
  console.error("Sidecar preparation failed:", error);
  process.exitCode = 1;
});
