// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SIDECAR_MANIFEST } from "./sidecar-manifest.mjs";
import {
  BENCHMARK_REQUEST,
  benchmarkServerArguments,
  completionThroughput,
} from "./sidecar-benchmark.mjs";

describe("local 4B sidecar performance comparison", () => {
  it("locks equivalent server and completion parameters", () => {
    expect(benchmarkServerArguments({ model: "D:/models/qwen.gguf", port: 4567 })).toEqual([
      "--model", "D:/models/qwen.gguf",
      "--host", "127.0.0.1",
      "--port", "4567",
      "--ctx-size", "2048",
      "--threads", "4",
      "--threads-batch", "4",
      "--parallel", "1",
    ]);
    expect(BENCHMARK_REQUEST).toMatchObject({
      n_predict: 64,
      temperature: 0,
      seed: 1234,
      cache_prompt: false,
    });
    expect(SIDECAR_MANIFEST.build.benchmarkRuns).toBe(3);
  });

  it("accepts only a positive server-reported generation rate", () => {
    expect(completionThroughput({ timings: { predicted_per_second: 12.5 } })).toBe(12.5);
    expect(() => completionThroughput({ timings: { predicted_per_second: 0 } }))
      .toThrow(/throughput/i);
    expect(() => completionThroughput({})).toThrow(/throughput/i);
  });
});
