import type { I18nKeys } from "@/i18n";

export type UserErrorContext =
  | "api_text"
  | "api_vision"
  | "translation"
  | "local";

export function userFacingErrorKey(
  error: unknown,
  context: UserErrorContext,
): I18nKeys {
  const message = String(error).toLowerCase();
  if (message.includes("api key") || message.includes("api 密钥")) {
    return context === "api_vision"
      ? "error_image_key_missing"
      : "error_api_key_missing";
  }
  if (
    message.includes("vlm 模型") ||
    message.includes("图像模型") ||
    message.includes("image model")
  ) {
    return "error_image_model_missing";
  }
  if (
    message.includes("不支持视觉") ||
    message.includes("不支持图像") ||
    message.includes("does not support vision") ||
    message.includes("does not support image")
  ) {
    return "error_image_unsupported";
  }
  if (
    message.includes("language pack") ||
    message.includes("ocr pack") ||
    message.includes("ocr 包") ||
    message.includes("语言包")
  ) {
    return "error_ocr_language";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "error_request_timeout";
  }
  if (/\b(429|502|503|504)\b/.test(message) || message.includes("service unavailable")) {
    return "error_service_unavailable";
  }
  if (context === "local") return "error_local_runtime";
  if (context === "api_text" || context === "api_vision") {
    return "error_api_test_generic";
  }
  return "error_translation_generic";
}

export function qualityFallbackWarningKey(warning: string): I18nKeys | null {
  if (!warning.includes("图像翻译失败，已改用文本翻译")) return null;
  if (warning.includes("请求超时")) return "warning_quality_fallback_timeout";
  if (warning.includes("服务暂不可用")) return "warning_quality_fallback_service";
  if (warning.includes("响应格式异常")) return "warning_quality_fallback_response";
  return "warning_quality_fallback_request";
}
