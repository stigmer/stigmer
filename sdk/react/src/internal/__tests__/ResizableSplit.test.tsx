import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ResizableSplit } from "../ResizableSplit";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSplit(
  overrides: Partial<React.ComponentProps<typeof ResizableSplit>> = {},
) {
  return render(
    <ResizableSplit
      primary={<div data-testid="primary">Primary</div>}
      secondary={<div data-testid="secondary">Secondary</div>}
      {...overrides}
    />,
  );
}

describe("ResizableSplit", () => {
  describe("rendering", () => {
    it("renders primary and secondary content", () => {
      renderSplit();
      expect(screen.getByTestId("primary")).toBeTruthy();
      expect(screen.getByTestId("secondary")).toBeTruthy();
    });

    it("renders a separator with correct ARIA attributes", () => {
      renderSplit({ minSize: 200, maxSize: 600 });
      const separator = screen.getByRole("separator");
      expect(separator).toBeTruthy();
      expect(separator.getAttribute("aria-orientation")).toBe("vertical");
      expect(separator.getAttribute("aria-valuemin")).toBe("200");
      expect(separator.getAttribute("aria-valuemax")).toBe("600");
    });

    it("applies default panel width of 384px", () => {
      renderSplit();
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-valuenow")).toBe("384");
    });

    it("applies custom defaultSize", () => {
      renderSplit({ defaultSize: 500 });
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-valuenow")).toBe("500");
    });
  });

  describe("localStorage persistence", () => {
    it("reads persisted width on mount", () => {
      localStorage.setItem("test-key", "450");
      renderSplit({ storageKey: "test-key" });
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-valuenow")).toBe("450");
    });

    it("ignores persisted width outside min/max bounds", () => {
      localStorage.setItem("test-key", "50");
      renderSplit({ storageKey: "test-key", minSize: 200, defaultSize: 384 });
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-valuenow")).toBe("384");
    });

    it("ignores non-numeric persisted values", () => {
      localStorage.setItem("test-key", "not-a-number");
      renderSplit({ storageKey: "test-key", defaultSize: 384 });
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-valuenow")).toBe("384");
    });
  });

  describe("keyboard interaction", () => {
    it("increases panel width on ArrowLeft", () => {
      renderSplit({ defaultSize: 400 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowLeft" });

      expect(separator.getAttribute("aria-valuenow")).toBe("420");
    });

    it("decreases panel width on ArrowRight", () => {
      renderSplit({ defaultSize: 400 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowRight" });

      expect(separator.getAttribute("aria-valuenow")).toBe("380");
    });

    it("clamps to minSize on ArrowRight", () => {
      renderSplit({ defaultSize: 290, minSize: 280 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowRight" });

      expect(separator.getAttribute("aria-valuenow")).toBe("280");
    });

    it("clamps to maxSize on ArrowLeft", () => {
      renderSplit({ defaultSize: 790, maxSize: 800 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowLeft" });

      expect(separator.getAttribute("aria-valuenow")).toBe("800");
    });

    it("persists width on keyboard resize", () => {
      renderSplit({ defaultSize: 400, storageKey: "kb-test" });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowLeft" });

      expect(localStorage.getItem("kb-test")).toBe("420");
    });
  });

  describe("onResize callback", () => {
    it("fires onResize with initial width on mount", () => {
      const onResize = vi.fn();
      renderSplit({ defaultSize: 350, onResize });
      expect(onResize).toHaveBeenCalledWith(350);
    });

    it("fires onResize on keyboard resize", () => {
      const onResize = vi.fn();
      renderSplit({ defaultSize: 400, onResize });
      onResize.mockClear();

      const separator = screen.getByRole("separator");
      fireEvent.keyDown(separator, { key: "ArrowLeft" });

      expect(onResize).toHaveBeenCalledWith(420);
    });
  });

  describe("accessibility", () => {
    it("separator is focusable via tabIndex", () => {
      renderSplit();
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("tabindex")).toBe("0");
    });

    it("has accessible label", () => {
      renderSplit();
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-label")).toBe(
        "Resize inspector panel",
      );
    });
  });
});
