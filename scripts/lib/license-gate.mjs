import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const RUST_REPORT = join("src-tauri", "licenses", "RUST_THIRD_PARTY_LICENSES.txt");
export const FRONTEND_REPORT = join("src-tauri", "licenses", "FRONTEND_THIRD_PARTY_LICENSES.txt");

export function gitStatusArguments() {
  return ["status", "--porcelain=v1", "--untracked-files=all"];
}

function describePorcelainChanges(output) {
  const kinds = new Set();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const status = line.slice(0, 2);
    if (status === "??") {
      kinds.add("untracked");
      continue;
    }
    if (status[0] && status[0] !== " ") kinds.add("staged");
    if (status[1] && status[1] !== " ") kinds.add("unstaged");
  }
  return [...kinds].sort((left, right) => left.localeCompare(right, "en"));
}

export function assertRepositoryClean({ root, runCommand = spawnSync }) {
  const args = gitStatusArguments();
  const result = runCommand("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  const porcelain = String(result.stdout ?? "");
  if (porcelain.length > 0) {
    const kinds = describePorcelainChanges(porcelain);
    throw new Error(`Repository is not clean (${kinds.join(", ")}):\n${porcelain}`);
  }
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (!npmCli) throw new Error("Unable to locate the npm CLI JavaScript entry point");
  return npmCli;
}

function runChecked(runCommand, command, args, options) {
  const result = runCommand(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
}

export function runLicenseGenerators({
  root,
  rustOutput,
  frontendOutput,
  runCommand = spawnSync,
}) {
  runChecked(runCommand, process.execPath, ["scripts/generate-rust-licenses.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OVERLAYTRANS_RUST_LICENSE_OUTPUT: rustOutput },
    maxBuffer: 128 * 1024 * 1024,
  });
  runChecked(runCommand, process.execPath, [npmCliPath(), "run", "build"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT: frontendOutput },
    maxBuffer: 128 * 1024 * 1024,
  });
}

function assertByteEqual(trackedPath, generatedPath) {
  const tracked = readFileSync(trackedPath);
  const generated = readFileSync(generatedPath);
  if (!tracked.equals(generated)) {
    throw new Error(`${trackedPath.split(/[\\/]/).pop()} license report drift detected`);
  }
}

export function checkLicenseReports({ root, runCommand = spawnSync }) {
  const tempRoot = mkdtempSync(join(tmpdir(), "overlaytrans-license-check-"));
  try {
    const rustOutput = join(tempRoot, "RUST_THIRD_PARTY_LICENSES.txt");
    const frontendOutput = join(tempRoot, "FRONTEND_THIRD_PARTY_LICENSES.txt");
    runLicenseGenerators({ root, rustOutput, frontendOutput, runCommand });
    assertByteEqual(join(root, RUST_REPORT), rustOutput);
    assertByteEqual(join(root, FRONTEND_REPORT), frontendOutput);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
