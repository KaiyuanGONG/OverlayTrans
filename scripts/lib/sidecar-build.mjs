import { SIDECAR_MANIFEST } from "./sidecar-manifest.mjs";
import { existsSync, renameSync, rmSync } from "node:fs";

export function activateStagedDirectory({ liveDir, stagingDir, backupDir }) {
  if (existsSync(backupDir)) {
    throw new Error(`Refusing activation with a pre-existing backup: ${backupDir}`);
  }
  let movedCurrent = false;
  let activated = false;
  try {
    if (existsSync(liveDir)) {
      renameSync(liveDir, backupDir);
      movedCurrent = true;
    }
    renameSync(stagingDir, liveDir);
    activated = true;
  } catch (error) {
    if (activated && existsSync(liveDir)) {
      rmSync(liveDir, { recursive: true, force: true });
    }
    if (movedCurrent && existsSync(backupDir)) {
      renameSync(backupDir, liveDir);
    }
    throw error;
  }
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
}

export function cmakeConfigureArguments({ sourceDir, buildDir }) {
  const definitions = Object.entries(SIDECAR_MANIFEST.build.definitions)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `-D${key}=${value}`);
  return [
    "-S", sourceDir,
    "-B", buildDir,
    "-G", SIDECAR_MANIFEST.build.generator,
    "-A", SIDECAR_MANIFEST.build.architecture,
    ...definitions,
  ];
}

export function cmakeBuildArguments({ buildDir }) {
  return [
    "--build", buildDir,
    "--config", SIDECAR_MANIFEST.build.configuration,
    "--target", SIDECAR_MANIFEST.build.target,
    "--parallel",
  ];
}

export function assertAvx2ProbeOutput(output) {
  if (String(output).trim() !== "AVX2_SUPPORTED") {
    throw new Error("AVX2 is required to build and smoke-test this sidecar");
  }
}

export function parseAndValidatePeDependencies(output) {
  const dependencies = [...String(output).matchAll(/^\s+([A-Za-z0-9_.-]+\.dll)\s*$/gmi)]
    .map((match) => match[1].toLowerCase())
    .filter((dependency, index, values) => values.indexOf(dependency) === index)
    .sort((left, right) => left.localeCompare(right, "en"));
  const forbidden = dependencies.find((dependency) => dependency.includes("libomp"));
  if (forbidden) {
    throw new Error(`Forbidden libomp PE dependency: ${forbidden}`);
  }
  const allowed = new Set(SIDECAR_MANIFEST.build.allowedPeDependencies);
  const unexpected = dependencies.filter((dependency) => !allowed.has(dependency));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected PE dependency: ${unexpected.join(", ")}`);
  }
  return dependencies;
}

export function assertVersionOutput(output) {
  const text = String(output);
  const shortCommit = SIDECAR_MANIFEST.build.commit.slice(0, 9);
  if (!text.includes(`version: ${SIDECAR_MANIFEST.build.number}`) || !text.includes(shortCommit)) {
    throw new Error(`Unexpected llama-server version output: ${text.trim()}`);
  }
}

export function medianOfThree(values) {
  if (!Array.isArray(values) || values.length !== SIDECAR_MANIFEST.build.benchmarkRuns) {
    throw new Error("Performance comparison requires exactly 3 runs");
  }
  const sorted = values.map(Number).sort((left, right) => left - right);
  if (sorted.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Performance results must be positive finite numbers");
  }
  return sorted[1];
}

export function assertPerformanceRatio({ baseline, candidate }) {
  const baselineMedian = medianOfThree(baseline);
  const candidateMedian = medianOfThree(candidate);
  const ratio = candidateMedian / baselineMedian;
  if (ratio < SIDECAR_MANIFEST.build.minimumPerformanceRatio) {
    throw new Error(
      `Static sidecar median is below the 70% baseline threshold (${(ratio * 100).toFixed(2)}%)`,
    );
  }
  return { baselineMedian, candidateMedian, ratio };
}
