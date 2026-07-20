#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRONTEND_REPORT,
  RUST_REPORT,
  runLicenseGenerators,
} from "./lib/license-gate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
runLicenseGenerators({
  root,
  rustOutput: join(root, RUST_REPORT),
  frontendOutput: join(root, FRONTEND_REPORT),
});
console.log("Tracked Rust and frontend runtime license reports regenerated.");
