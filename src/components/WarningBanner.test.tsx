import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WarningBanner } from "@/components/WarningBanner";

describe("WarningBanner", () => {
  it("renders the fallback warning and supports explicit dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <WarningBanner
        message="Quality failed; using Speed"
        dismissLabel="Dismiss"
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Quality failed; using Speed");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
