// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import {
  assertRepositoryClean,
  checkLicenseReports,
  gitStatusArguments,
  runLicenseGenerators,
} from "./license-gate.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "overlaytrans-license-gate-test-"));
  roots.push(root);
  mkdirSync(join(root, "src-tauri", "licenses"), { recursive: true });
  writeFileSync(join(root, "src-tauri", "licenses", "RUST_THIRD_PARTY_LICENSES.txt"), "rust\n");
  writeFileSync(join(root, "src-tauri", "licenses", "FRONTEND_THIRD_PARTY_LICENSES.txt"), "front\n");
  return root;
}

describe("third-party license release gate", () => {
  it("pins fixed generation, temporary checking and clean-tree commands", () => {
    expect(packageJson.scripts["licenses:generate"]).toBe("node scripts/generate-third-party-licenses.mjs");
    expect(packageJson.scripts["licenses:check"]).toBe("node scripts/check-third-party-licenses.mjs");
    expect(packageJson.scripts["licenses:gate"]).toBe("node scripts/check-license-release-gate.mjs");
    expect(gitStatusArguments()).toEqual([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
  });

  it("passes separate Rust and frontend output paths to the fixed generators", () => {
    const calls = [];
    runLicenseGenerators({
      root: "D:/repo",
      rustOutput: "D:/temp/rust.txt",
      frontendOutput: "D:/temp/front.txt",
      runCommand(command, args, options) {
        calls.push({ command, args, env: options.env, shell: options.shell });
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(["scripts/generate-rust-licenses.mjs"]);
    expect(calls[0].env.OVERLAYTRANS_RUST_LICENSE_OUTPUT).toBe("D:/temp/rust.txt");
    expect(calls[1].command).toBe(process.execPath);
    expect(calls[1].args.slice(-2)).toEqual(["run", "build"]);
    expect(calls[1].args[0]).toMatch(/npm-cli\.js$/);
    expect(calls[1].env.OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT).toBe("D:/temp/front.txt");
    expect(calls[1].shell).toBeUndefined();
  });

  it("regenerates into a temporary directory and byte-compares without overwriting tracked files", () => {
    const root = fixtureRoot();
    const trackedRust = join(root, "src-tauri", "licenses", "RUST_THIRD_PARTY_LICENSES.txt");
    const trackedFrontend = join(root, "src-tauri", "licenses", "FRONTEND_THIRD_PARTY_LICENSES.txt");
    const outputPaths = [];
    checkLicenseReports({
      root,
      runCommand(_command, args, options) {
        if (args[0] === "scripts/generate-rust-licenses.mjs") {
          outputPaths.push(options.env.OVERLAYTRANS_RUST_LICENSE_OUTPUT);
          writeFileSync(options.env.OVERLAYTRANS_RUST_LICENSE_OUTPUT, "rust\n");
        } else {
          outputPaths.push(options.env.OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT);
          writeFileSync(options.env.OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT, "front\n");
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    expect(outputPaths.every((path) => !path.startsWith(join(root, "src-tauri", "licenses"))))
      .toBe(true);
    expect(readFileSync(trackedRust, "utf8")).toBe("rust\n");
    expect(readFileSync(trackedFrontend, "utf8")).toBe("front\n");
  });

  it("fails on a single-byte report drift", () => {
    const root = fixtureRoot();
    expect(() => checkLicenseReports({
      root,
      runCommand(_command, args, options) {
        if (args[0] === "scripts/generate-rust-licenses.mjs") {
          writeFileSync(options.env.OVERLAYTRANS_RUST_LICENSE_OUTPUT, "rust changed\n");
        } else {
          writeFileSync(options.env.OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT, "front\n");
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    })).toThrow(/RUST_THIRD_PARTY_LICENSES\.txt.*drift/i);
  });

  it.each([
    ["staged", "M  tracked.txt\n"],
    ["unstaged", " M tracked.txt\n"],
    ["untracked", "?? new.txt\n"],
  ])("rejects %s repository changes", (kind, porcelain) => {
    const calls = [];
    expect(() => assertRepositoryClean({
      root: "D:/repo",
      runCommand(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: porcelain, stderr: "" };
      },
    })).toThrow(new RegExp(`${kind}|repository is not clean`, "i"));
    expect(calls).toMatchObject([{
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      options: { cwd: "D:/repo", encoding: "utf8" },
    }]);
  });
});
