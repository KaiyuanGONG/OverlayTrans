import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { assertPerformanceRatio } from "./sidecar-build.mjs";
import { SIDECAR_MANIFEST } from "./sidecar-manifest.mjs";

export const BENCHMARK_REQUEST = Object.freeze({
  prompt: "Respond with a concise explanation of why deterministic software builds are useful.",
  n_predict: 64,
  temperature: 0,
  seed: 1234,
  cache_prompt: false,
  ignore_eos: true,
});

export function benchmarkServerArguments({ model, port }) {
  return [
    "--model", model,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--ctx-size", "2048",
    "--threads", "4",
    "--threads-batch", "4",
    "--parallel", "1",
  ];
}

export function completionThroughput(response) {
  const throughput = Number(response?.timings?.predicted_per_second);
  if (!Number.isFinite(throughput) || throughput <= 0) {
    throw new Error("llama-server response did not contain a positive generation throughput");
  }
  return throughput;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(baseUrl, processHandle, diagnostics) {
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`llama-server exited before becoming ready:\n${diagnostics()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for llama-server:\n${diagnostics()}`);
}

async function requestCompletion(baseUrl) {
  const response = await fetch(`${baseUrl}/completion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(BENCHMARK_REQUEST),
  });
  if (!response.ok) {
    throw new Error(`Completion request failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function stopProcess(processHandle) {
  if (processHandle.exitCode !== null) return;
  const exited = new Promise((resolve) => processHandle.once("exit", resolve));
  processHandle.kill();
  await Promise.race([exited, delay(5000)]);
}

export async function runSidecarBenchmark({ binary, model, label }) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const processHandle = spawn(binary, benchmarkServerArguments({ model, port }), {
    cwd: dirname(binary),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-32_000);
  };
  processHandle.stdout.on("data", append);
  processHandle.stderr.on("data", append);
  try {
    await waitForServer(baseUrl, processHandle, () => output);
    await requestCompletion(baseUrl);
    const samples = [];
    for (let run = 0; run < SIDECAR_MANIFEST.build.benchmarkRuns; run += 1) {
      const throughput = completionThroughput(await requestCompletion(baseUrl));
      samples.push(throughput);
      console.log(`${label} run ${run + 1}: ${throughput.toFixed(3)} tokens/s`);
    }
    return samples;
  } finally {
    await stopProcess(processHandle);
  }
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: node scripts/lib/sidecar-benchmark.mjs --baseline <exe> --candidate <exe> --model <gguf>");
    }
    parsed[key.slice(2)] = value;
  }
  for (const required of ["baseline", "candidate", "model"]) {
    if (!parsed[required]) throw new Error(`Missing --${required}`);
  }
  return parsed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const baseline = await runSidecarBenchmark({
    binary: options.baseline,
    model: options.model,
    label: "baseline",
  });
  const candidate = await runSidecarBenchmark({
    binary: options.candidate,
    model: options.model,
    label: "candidate",
  });
  const comparison = assertPerformanceRatio({ baseline, candidate });
  console.log(JSON.stringify({ baseline, candidate, ...comparison }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
