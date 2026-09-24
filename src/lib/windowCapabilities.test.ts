import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import captureOverlaySource from "../windows/CaptureOverlay.tsx?raw";

describe("capture window capability contract", () => {
  it("grants the drag and resize permissions the capture overlay calls", () => {
    expect(captureOverlaySource).toContain("startDragging()");
    expect(captureOverlaySource).toContain("startResizeDragging(");
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    expect(capability.permissions).toContain("core:window:allow-start-resize-dragging");
  });
});
