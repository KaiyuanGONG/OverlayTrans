import { describe, expect, it } from "vitest";
import { getLocale } from "@/i18n";

describe("concise UI copy contract", () => {
  it("keeps Chinese and English key sets identical", () => {
    expect(Object.keys(getLocale("en")).sort()).toEqual(
      Object.keys(getLocale("zh")).sort(),
    );
  });

  it("pins the approved high-visibility wording", () => {
    const zh = getLocale("zh");
    const en = getLocale("en");
    expect(zh.reset_defaults).toBe("重置设置");
    expect(zh.trigger_threshold).toBe("变化阈值");
    expect(zh.ocr_winrt).toBe("Windows 系统 OCR");
    expect(zh.mode_quality).toBe("质量模式");
    expect(zh.capture_status_ocr).toBe("识别中");
    expect(zh.capture_auto_label).toBe("自动");
    expect(zh.capture_no_preview).toBe("暂无预览，请先翻译一次");
    expect(zh.ob_done_enjoy).toBe("开始使用");
    expect(en.reset_defaults).toBe("Reset settings");
    expect(en.mode_quality).toBe("Quality mode");
  });

  it("uses a typographic ellipsis and removes internal jargon", () => {
    for (const lang of ["zh", "en"] as const) {
      const joined = Object.values(getLocale(lang)).join("\n");
      expect(joined).not.toContain("...");
      expect(joined).not.toMatch(/\(VLM\)|（VLM|\(HSL|\(pHash|OCR识别|\bAUTO\b/);
    }
  });

  it("keeps the onboarding next label free of a duplicate arrow", () => {
    expect(getLocale("zh").ob_next).toBe("下一步");
    expect(getLocale("en").ob_next).toBe("Next");
  });
});
