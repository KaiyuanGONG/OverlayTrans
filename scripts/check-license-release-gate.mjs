#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRepositoryClean, checkLicenseReports } from "./lib/license-gate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
checkLicenseReports({ root });
assertRepositoryClean({ root });
console.log("License reports are current and the repository is clean.");
