import { describe, it, expect, beforeEach } from "vitest";
import { useTranslationStore } from "./translationStore";

describe("TranslationStore", () => {
  beforeEach(() => {
    // Reset store before each test
    useTranslationStore.setState({
      history: [],
      currentStatus: "idle",
      lastError: null,
      isAutoMode: false,
      streamingText: "",
      isStreaming: false,
      currentGeneration: 0,
      warning: null,
    });
  });

  it("starts with empty history and idle status", () => {
    const state = useTranslationStore.getState();
    expect(state.history).toEqual([]);
    expect(state.currentStatus).toBe("idle");
    expect(state.lastError).toBeNull();
  });

  it("addTranslation adds entry to history", () => {
    const { addTranslation } = useTranslationStore.getState();
    addTranslation(
      {
        id: "test-1",
        timestamp: Date.now(),
        source_text: "hello",
        translated_text: "你好",
        ocr_engine: "winrt-en",
        translation_engine: "speed",
        provider_label: "DeepSeek",
        latency_ms: 100,
      },
      1
    );

    const state = useTranslationStore.getState();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].source_text).toBe("hello");
    expect(state.currentStatus).toBe("done");
  });

  it("addTranslation with stale generation is discarded", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5
    useTranslationStore.setState({ currentGeneration: 5 });

    // Try to add with generation 3 (stale)
    store.addTranslation(
      {
        id: "stale-1",
        timestamp: Date.now(),
        source_text: "stale",
        translated_text: "过期",
        ocr_engine: "winrt-en",
        translation_engine: "speed",
        provider_label: "DeepSeek",
        latency_ms: 100,
      },
      3
    );

    const state = useTranslationStore.getState();
    expect(state.history).toHaveLength(0); // Discarded
  });

  it("addTranslation with current generation is accepted", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5
    useTranslationStore.setState({ currentGeneration: 5 });

    // Add with generation 5 (current)
    store.addTranslation(
      {
        id: "current-1",
        timestamp: Date.now(),
        source_text: "current",
        translated_text: "当前",
        ocr_engine: "winrt-en",
        translation_engine: "speed",
        provider_label: "DeepSeek",
        latency_ms: 100,
      },
      5
    );

    const state = useTranslationStore.getState();
    expect(state.history).toHaveLength(1); // Accepted
  });

  it("setStatus with stale generation is discarded", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5
    useTranslationStore.setState({ currentGeneration: 5 });

    // Try to set status with generation 3 (stale)
    store.setStatus("translating", 3);

    const state = useTranslationStore.getState();
    expect(state.currentStatus).toBe("idle"); // Not changed
  });

  it("setStatus with current generation is accepted", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5
    useTranslationStore.setState({ currentGeneration: 5 });

    // Set status with generation 5 (current)
    store.setStatus("translating", 5);

    const state = useTranslationStore.getState();
    expect(state.currentStatus).toBe("translating"); // Changed
  });

  it("startStreaming with stale generation is discarded", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5
    useTranslationStore.setState({ currentGeneration: 5 });

    // Try to start streaming with generation 3 (stale)
    store.startStreaming(3);

    const state = useTranslationStore.getState();
    expect(state.isStreaming).toBe(false); // Not changed
  });

  it("appendChunk with stale generation is discarded", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5 and start streaming
    useTranslationStore.setState({
      currentGeneration: 5,
      isStreaming: true,
      streamingText: "",
    });

    // Try to append chunk with generation 3 (stale)
    store.appendChunk("stale chunk", 3);

    const state = useTranslationStore.getState();
    expect(state.streamingText).toBe(""); // Not changed
  });

  it("appendChunk with current generation appends text", () => {
    const store = useTranslationStore.getState();

    // Set current generation to 5 and start streaming
    useTranslationStore.setState({
      currentGeneration: 5,
      isStreaming: true,
      streamingText: "",
    });

    // Append chunk with generation 5 (current)
    store.appendChunk("hello ", 5);
    store.appendChunk("world", 5);

    const state = useTranslationStore.getState();
    expect(state.streamingText).toBe("hello world");
  });

  it("new generation clears streaming text", () => {
    const store = useTranslationStore.getState();

    // Set up streaming state with generation 5
    useTranslationStore.setState({
      currentGeneration: 5,
      isStreaming: true,
      streamingText: "old text",
    });

    // Start streaming with new generation 6
    store.startStreaming(6);

    const state = useTranslationStore.getState();
    expect(state.currentGeneration).toBe(6);
    expect(state.isStreaming).toBe(true);
    expect(state.streamingText).toBe(""); // Cleared
  });

  it("lock conflict does not clear current generation stream", () => {
    const store = useTranslationStore.getState();

    // Set up streaming state with generation 5
    useTranslationStore.setState({
      currentGeneration: 5,
      isStreaming: true,
      streamingText: "current text",
    });

    // Try to set idle with stale generation (simulating lock conflict)
    store.setStatus("idle", 3);

    const state = useTranslationStore.getState();
    expect(state.streamingText).toBe("current text"); // Not cleared
    expect(state.isStreaming).toBe(true); // Not changed
  });

  // ── Warning (sticky) tests ──

  it("setWarning sets warning for current generation", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5 });

    store.setWarning("Quality failed, fell back to Speed", 5);

    const state = useTranslationStore.getState();
    expect(state.warning).toBe("Quality failed, fell back to Speed");
  });

  it("setWarning with stale generation is discarded", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: null });

    store.setWarning("stale warning", 3);

    const state = useTranslationStore.getState();
    expect(state.warning).toBeNull();
  });

  it("warning is sticky — not cleared by done status", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: "fallback warning" });

    store.setStatus("done", 5);

    const state = useTranslationStore.getState();
    expect(state.warning).toBe("fallback warning");
  });

  it("warning is sticky — not cleared by idle status", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: "fallback warning" });

    store.setStatus("idle", 5);

    const state = useTranslationStore.getState();
    expect(state.warning).toBe("fallback warning");
  });

  it("warning is sticky — not cleared by error status", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: "fallback warning" });

    store.setStatus("error", 5, "some error");

    const state = useTranslationStore.getState();
    expect(state.warning).toBe("fallback warning");
  });

  it("warning is cleared by new generation (startStreaming)", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: "old warning" });

    store.startStreaming(6);

    const state = useTranslationStore.getState();
    expect(state.warning).toBeNull();
    expect(state.currentGeneration).toBe(6);
  });

  it("same-generation fallback translating status keeps warning sticky", () => {
    useTranslationStore.setState({ currentGeneration: 5, warning: "fallback warning" });

    useTranslationStore.getState().startStreaming(5);

    expect(useTranslationStore.getState().warning).toBe("fallback warning");
  });

  it("a new generation clears warning on its first status event", () => {
    useTranslationStore.setState({ currentGeneration: 5, warning: "old warning" });

    useTranslationStore.getState().setStatus("capturing", 6);

    expect(useTranslationStore.getState().warning).toBeNull();
  });

  it("warning is not cleared by addTranslation", () => {
    const store = useTranslationStore.getState();
    useTranslationStore.setState({ currentGeneration: 5, warning: "fallback warning" });

    store.addTranslation(
      {
        id: "test-warning",
        timestamp: Date.now(),
        source_text: "hello",
        translated_text: "你好",
        ocr_engine: "vlm-qwen3.6-flash",
        translation_engine: "quality",
        provider_label: "Qwen",
        latency_ms: 200,
      },
      5,
    );

    const state = useTranslationStore.getState();
    expect(state.warning).toBe("fallback warning");
    expect(state.history).toHaveLength(1);
  });
});
