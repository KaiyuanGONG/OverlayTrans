import { describe, expect, it } from "vitest";
import { qualityFallbackWarningKey, userFacingErrorKey } from "@/lib/userFacingError";

describe("userFacingErrorKey", () => {
  it.each([
    ["API Key 为空", "api_vision", "error_image_key_missing"],
    ["VLM 模型未配置", "api_vision", "error_image_model_missing"],
    ["provider does not support vision", "translation", "error_image_unsupported"],
    ["OCR language pack is not installed", "translation", "error_ocr_language"],
    ["request timed out after 30s", "api_text", "error_request_timeout"],
    ["HTTP 503 giant body", "translation", "error_service_unavailable"],
    ["llama server failed", "local", "error_local_runtime"],
  ] as const)("maps %s in %s", (message, context, expected) => {
    expect(userFacingErrorKey(message, context)).toBe(expected);
  });

  it("never returns raw provider payloads", () => {
    expect(userFacingErrorKey("provider secret diagnostic payload", "translation"))
      .toBe("error_translation_generic");
  });

  it("localizes the known quality fallback warning", () => {
    expect(qualityFallbackWarningKey("图像翻译失败，已改用文本翻译：请求超时"))
      .toBe("warning_quality_fallback_timeout");
    expect(qualityFallbackWarningKey("unrelated warning")).toBeNull();
  });
});
