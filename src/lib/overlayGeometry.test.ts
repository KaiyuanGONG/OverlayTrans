import { describe, expect, it } from "vitest";
import { computePhysicalInsets } from "./overlayGeometry";

describe("computePhysicalInsets", () => {
  it("measures the inner content at 100% DPI", () => {
    expect(
      computePhysicalInsets(
        { left: 6, top: 24, right: 634, bottom: 154 },
        { width: 640, height: 160 },
        1,
      ),
    ).toEqual([6, 24, 6, 6]);
  });

  it("rounds inward at fractional DPI", () => {
    expect(
      computePhysicalInsets(
        { left: 6, top: 24, right: 634, bottom: 154 },
        { width: 640, height: 160 },
        1.25,
      ),
    ).toEqual([8, 30, 7, 7]);
  });

  it("reduces to title-only insets without a border", () => {
    expect(
      computePhysicalInsets(
        { left: 0, top: 24, right: 640, bottom: 160 },
        { width: 640, height: 160 },
        1,
      ),
    ).toEqual([0, 24, 0, 0]);
  });

  it("includes the Windows non-client frame around the WebView", () => {
    expect(
      computePhysicalInsets(
        { left: 6, top: 30, right: 398, bottom: 122 },
        { width: 404, height: 128 },
        1.5,
        {
          clientOffsetX: 8,
          clientOffsetY: 8,
          outerWidth: 622,
          outerHeight: 208,
        },
      ),
    ).toEqual([17, 53, 17, 17]);
  });

  it("rejects an invalid device pixel ratio", () => {
    expect(() =>
      computePhysicalInsets(
        { left: 0, top: 24, right: 640, bottom: 160 },
        { width: 640, height: 160 },
        0,
      ),
    ).toThrow("devicePixelRatio must be positive");
  });
});
