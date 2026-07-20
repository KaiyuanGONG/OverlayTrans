#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLicenseReports } from "./lib/license-gate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
checkLicenseReports({ root });
console.log("Tracked Rust and frontend runtime license reports are byte-for-byte current.");
