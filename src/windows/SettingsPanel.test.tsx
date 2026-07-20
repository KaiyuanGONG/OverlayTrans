import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLangStore } from "@/stores/langStore";
import { DEFAULT_CONFIG, type PresetInfo } from "@/types/config";
import { ApiTab } from "@/windows/SettingsPanel";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn(), hide: vi.fn(), show: vi.fn() }),
}));
vi.mock("@/stores/themeStore", () => ({
  useThemeStore: () => ({ initFromConfig: vi.fn(), setTheme: vi.fn() }),
}));

const presets: PresetInfo[] = [
  {
    id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com",
    text_models: ["deepseek-v4-flash"], vlm_models: [],
    default_text_model: "deepseek-v4-flash", default_vlm_model: "",
    supports_vision: false, qwen_international_base_url: null,
  },
  {
    id: "qwen", label: "Qwen", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    text_models: ["qwen3.6-flash"],
    vlm_models: ["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-plus"],
    default_text_model: "qwen3.6-flash", default_vlm_model: "qwen3.6-flash",
    supports_vision: true,
    qwen_international_base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "gemini", label: "Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    text_models: ["gemini-3.1-flash-lite"],
    vlm_models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
    default_text_model: "gemini-3.1-flash-lite",
    default_vlm_model: "gemini-3.5-flash", supports_vision: true,
    qwen_international_base_url: null,
  },
  {
    id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1",
    text_models: ["openai/gpt-oss-20b"], vlm_models: [],
    default_text_model: "openai/gpt-oss-20b", default_vlm_model: "",
    supports_vision: false, qwen_international_base_url: null,
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  useLangStore.getState().setLang("zh");
});

it("shows one key field and an independent-config action while DeepSeek is followed", () => {
  render(<ApiTab config={DEFAULT_CONFIG} onChange={vi.fn()} presets={presets} isLoading={false} />);
  expect(screen.getByText("文本翻译")).toBeInTheDocument();
  expect(screen.getByText("图像翻译")).toBeInTheDocument();
  expect(screen.getAllByLabelText("API Key")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "使用独立配置" })).toBeInTheDocument();
});

it("separate image provider list excludes non-vision presets", () => {
  const config = {
    ...DEFAULT_CONFIG,
    api: {
      ...DEFAULT_CONFIG.api,
      vision: { ...DEFAULT_CONFIG.api.vision, mode: "separate" as const },
    },
  };
  render(<ApiTab config={config} onChange={vi.fn()} presets={presets} isLoading={false} />);
  const select = screen.getByLabelText("图像服务商");
  expect(within(select).queryByRole("option", { name: /DeepSeek/ })).toBeNull();
  expect(within(select).queryByRole("option", { name: /Groq/ })).toBeNull();
  expect(screen.getAllByLabelText("API Key")).toHaveLength(2);
});

it("tests text and image profiles through different commands and result areas", async () => {
  const config = {
    ...DEFAULT_CONFIG,
    api: {
      ...DEFAULT_CONFIG.api,
      api_key: "text-secret",
      vision: {
        ...DEFAULT_CONFIG.api.vision,
        mode: "separate" as const,
        api_key: "vision-secret",
      },
    },
  };
  invokeMock
    .mockResolvedValueOnce({ provider: "DeepSeek", model: "deepseek-v4-flash", test_type: "text", latency_ms: 1, output: "文本成功" })
    .mockResolvedValueOnce({ provider: "Qwen", model: "qwen3.6-flash", test_type: "vlm", latency_ms: 2, output: "图像成功" });
  render(<ApiTab config={config} onChange={vi.fn()} presets={presets} isLoading={false} />);

  fireEvent.click(screen.getByRole("button", { name: "测试文本翻译" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("test_api_text", { api: config.api }));
  fireEvent.click(screen.getByRole("button", { name: "测试图像翻译" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("test_api_vlm", { api: config.api }));
  expect(await screen.findByText(/文本成功/)).toBeInTheDocument();
  expect(await screen.findByText(/图像成功/)).toBeInTheDocument();
});
