import { describe, expect, it } from "vitest";
import readme from "../../README.md?raw";
import readmeZh from "../../README.zh-CN.md?raw";
import architecture from "../../docs/ARCHITECTURE.md?raw";
import packaging from "../../docs/PACKAGING_WINDOWS.md?raw";

describe("local CPU requirements documentation", () => {
  it("explains the Local-only AVX2 requirement in English", () => {
    expect(readme).toContain("Local mode requires an AVX2-compatible processor");
    expect(readme).toContain("Speed and Quality modes are unaffected");
    expect(architecture).toContain("AVX2-compatible CPU");
  });

  it("explains the Local-only AVX2 requirement in Chinese", () => {
    expect(readmeZh).toContain("本地模式需要支持 AVX2 的处理器");
    expect(readmeZh).toContain("在线速度/质量模式不受此限制");
    expect(packaging).toContain("本地模式要求 AVX2 兼容 CPU");
  });
});
