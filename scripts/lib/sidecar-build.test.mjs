// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIDECAR_MANIFEST } from "./sidecar-manifest.mjs";
import {
  activateStagedDirectory,
  assertAvx2ProbeOutput,
  assertPerformanceRatio,
  assertVersionOutput,
  cmakeBuildArguments,
  cmakeConfigureArguments,
  medianOfThree,
  parseAndValidatePeDependencies,
} from "./sidecar-build.mjs";

describe("reproducible static llama.cpp sidecar build", () => {
  it("pins the b10068 source archive and exact build identity", () => {
    expect(SIDECAR_MANIFEST.source).toEqual({
      url: "https://codeload.github.com/ggml-org/llama.cpp/zip/571d0d540df04f25298d0e159e520d9fc62ed121",
      revision: "571d0d540df04f25298d0e159e520d9fc62ed121",
      sha256: "4f9d93b5c37d0cf81933a8bcaaffa7b465f75fe87893cad9962719a21a6e7901",
      file: "llama.cpp-571d0d540df04f25298d0e159e520d9fc62ed121.zip",
    });
    expect(SIDECAR_MANIFEST.license).toEqual({
      sourceFile: "LICENSE",
      sha256: "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d",
      output: "llama-server-LICENSE.txt",
    });
    expect(SIDECAR_MANIFEST.build.number).toBe(10068);
    expect(SIDECAR_MANIFEST.build.commit).toBe(SIDECAR_MANIFEST.source.revision);
  });

  it("locks static MSVC CRT, tools/server switches and CPU policy", () => {
    expect(SIDECAR_MANIFEST.build).toMatchObject({
      generator: "Visual Studio 17 2022",
      architecture: "x64",
      configuration: "Release",
      target: "llama-server",
      output: "llama-server.exe",
      requiredAvx2: true,
      benchmarkRuns: 3,
      minimumPerformanceRatio: 0.7,
    });
    expect(SIDECAR_MANIFEST.build.definitions).toMatchObject({
      CMAKE_MSVC_RUNTIME_LIBRARY: "MultiThreaded",
      BUILD_SHARED_LIBS: "OFF",
      GGML_OPENMP: "OFF",
      GGML_NATIVE: "OFF",
      GGML_BACKEND_DL: "OFF",
      GGML_CPU_ALL_VARIANTS: "OFF",
      GGML_AVX: "ON",
      GGML_AVX2: "ON",
      GGML_BMI2: "ON",
      GGML_FMA: "ON",
      GGML_F16C: "ON",
      GGML_AVX512: "OFF",
      LLAMA_BUILD_NUMBER: "10068",
      LLAMA_BUILD_COMMIT: "571d0d540df04f25298d0e159e520d9fc62ed121",
      LLAMA_BUILD_COMMON: "ON",
      LLAMA_BUILD_TOOLS: "ON",
      LLAMA_BUILD_SERVER: "ON",
      LLAMA_BUILD_APP: "OFF",
      LLAMA_BUILD_TESTS: "OFF",
      LLAMA_BUILD_EXAMPLES: "OFF",
      LLAMA_BUILD_UI: "OFF",
      LLAMA_USE_PREBUILT_UI: "OFF",
      LLAMA_OPENSSL: "OFF",
    });
  });

  it("constructs deterministic configure and build commands", () => {
    const configure = cmakeConfigureArguments({ sourceDir: "D:/tmp/src", buildDir: "D:/tmp/build" });
    expect(configure.slice(0, 8)).toEqual([
      "-S", "D:/tmp/src", "-B", "D:/tmp/build",
      "-G", "Visual Studio 17 2022", "-A", "x64",
    ]);
    expect(configure).toContain("-DGGML_OPENMP=OFF");
    expect(configure).toContain("-DGGML_BMI2=ON");
    expect(configure).toContain("-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
    expect(configure).toContain("-DLLAMA_BUILD_TOOLS=ON");
    expect(cmakeBuildArguments({ buildDir: "D:/tmp/build" })).toEqual([
      "--build", "D:/tmp/build", "--config", "Release", "--target", "llama-server",
      "--parallel",
    ]);
  });

  it("requires an AVX2-capable build and smoke host", () => {
    expect(() => assertAvx2ProbeOutput("AVX2_SUPPORTED\n")).not.toThrow();
    expect(() => assertAvx2ProbeOutput("AVX2_UNSUPPORTED\n")).toThrow(/AVX2/i);
  });

  it("accepts only locked PE dependencies and always rejects libomp", () => {
    const safe = [
      "Image has the following dependencies:",
      "    ADVAPI32.dll",
      "    KERNEL32.dll",
      "    SHELL32.dll",
      "    WS2_32.dll",
    ].join("\n");
    expect(parseAndValidatePeDependencies(safe)).toEqual([
      "advapi32.dll",
      "kernel32.dll",
      "shell32.dll",
      "ws2_32.dll",
    ]);
    expect(() => parseAndValidatePeDependencies(`${safe}\n    libomp140.x86_64.dll\n`))
      .toThrow(/libomp/i);
    expect(() => parseAndValidatePeDependencies(`${safe}\n    unexpected-runtime.dll\n`))
      .toThrow(/unexpected PE dependency/i);
  });

  it("requires the pinned version and compares three-run medians at 70 percent", () => {
    expect(() => assertVersionOutput("version: 10068 (571d0d540)\n")).not.toThrow();
    expect(() => assertVersionOutput("version: 10067 (deadbeef)\n")).toThrow(/version/i);
    expect(medianOfThree([11, 9, 10])).toBe(10);
    expect(() => medianOfThree([1, 2])).toThrow(/exactly 3/i);
    expect(assertPerformanceRatio({ baseline: [10, 12, 11], candidate: [8, 7.8, 8.2] }))
      .toMatchObject({ baselineMedian: 11, candidateMedian: 8, ratio: 8 / 11 });
    expect(() => assertPerformanceRatio({ baseline: [10, 12, 11], candidate: [7, 7.1, 6.9] }))
      .toThrow(/70%/i);
  });

  it("restores the previous usable runtime when activation fails", () => {
    expect(activateStagedDirectory).toBeTypeOf("function");
    const root = mkdtempSync(join(tmpdir(), "overlaytrans-sidecar-rollback-"));
    const liveDir = join(root, "binaries");
    const missingStagingDir = join(root, "missing-staging");
    const backupDir = join(root, "binaries-backup");
    try {
      mkdirSync(liveDir);
      writeFileSync(join(liveDir, "old-runtime.txt"), "usable", "utf8");
      expect(() => activateStagedDirectory({
        liveDir,
        stagingDir: missingStagingDir,
        backupDir,
      })).toThrow();
      expect(existsSync(liveDir)).toBe(true);
      expect(readFileSync(join(liveDir, "old-runtime.txt"), "utf8")).toBe("usable");
      expect(existsSync(backupDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
