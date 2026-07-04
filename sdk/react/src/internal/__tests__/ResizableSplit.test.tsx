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

  describe("collapsedPane", () => {
    /** The pane wrapper div for a rendered probe. */
    function paneOf(testId: string): HTMLElement {
      return screen.getByTestId(testId).parentElement as HTMLElement;
    }

    it("hides the collapsed pane and the separator; the sibling flexes", () => {
      renderSplit({ collapsedPane: "secondary" });
      expect(paneOf("secondary").className).toContain("hidden");
      expect(paneOf("primary").className).toContain("flex-1");
      const separator = screen.getByRole("separator", { hidden: true });
      expect(separator.className).toContain("hidden");
      expect(separator.getAttribute("tabindex")).toBe("-1");
    });

    it("overrides the resizable pane's fixed width while collapsed", () => {
      renderSplit({ resizablePane: "primary", collapsedPane: "secondary" });
      // Primary is normally pixel-sized; with its sibling collapsed it flexes.
      expect(paneOf("primary").style.width).toBe("");
      expect(paneOf("primary").className).toContain("flex-1");
    });

    it("keeps both children mounted (same DOM nodes) across a collapse toggle", () => {
      const { rerender } = render(
        <ResizableSplit
          resizablePane="primary"
          collapsedPane="secondary"
          primary={<div data-testid="primary">Primary</div>}
          secondary={<div data-testid="secondary">Secondary</div>}
        />,
      );
      const primaryBefore = screen.getByTestId("primary");
      const secondaryBefore = screen.getByTestId("secondary");
      rerender(
        <ResizableSplit
          resizablePane="primary"
          collapsedPane="none"
          primary={<div data-testid="primary">Primary</div>}
          secondary={<div data-testid="secondary">Secondary</div>}
        />,
      );
      // Identical node references — expanding never remounted either pane.
      expect(screen.getByTestId("primary")).toBe(primaryBefore);
      expect(screen.getByTestId("secondary")).toBe(secondaryBefore);
      expect(paneOf("primary").style.width).toBe("384px");
    });

    it("restores the persisted width when expanding after a collapse", () => {
      localStorage.setItem("collapse-key", "451");
      renderSplit({
        resizablePane: "primary",
        collapsedPane: "secondary",
        storageKey: "collapse-key",
        minSize: 300,
        maxSize: 600,
      });
      const separator = screen.getByRole("separator", { hidden: true });
      expect(separator.getAttribute("aria-valuenow")).toBe("451");
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

    it("has a default accessible label", () => {
      renderSplit();
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-label")).toBe("Resize panel");
    });

    it("uses a custom accessible label", () => {
      renderSplit({ ariaLabel: "Resize file explorer" });
      const separator = screen.getByRole("separator");
      expect(separator.getAttribute("aria-label")).toBe("Resize file explorer");
    });
  });

  describe("resizablePane", () => {
    it("grows a primary pane on ArrowRight (toward its own side)", () => {
      renderSplit({ resizablePane: "primary", defaultSize: 400 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowRight" });

      expect(separator.getAttribute("aria-valuenow")).toBe("420");
    });

    it("shrinks a primary pane on ArrowLeft", () => {
      renderSplit({ resizablePane: "primary", defaultSize: 400 });
      const separator = screen.getByRole("separator");

      fireEvent.keyDown(separator, { key: "ArrowLeft" });

      expect(separator.getAttribute("aria-valuenow")).toBe("380");
    });
  });

  describe("width re-initialization on key change", () => {
    it("reloads the width from the new storageKey without remounting", () => {
      localStorage.setItem("key-a", "300");
      localStorage.setItem("key-b", "520");
      const { rerender } = render(
        <ResizableSplit
          primary={<div data-testid="primary">Primary</div>}
          secondary={<div data-testid="secondary">Secondary</div>}
          storageKey="key-a"
          minSize={200}
          maxSize={600}
        />,
      );
      const primary = screen.getByTestId("primary");
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
        "300",
      );

      rerender(
        <ResizableSplit
          primary={<div data-testid="primary">Primary</div>}
          secondary={<div data-testid="secondary">Secondary</div>}
          storageKey="key-b"
          resizablePane="primary"
          minSize={200}
          maxSize={600}
        />,
      );

      // Same DOM node — the child was re-flowed, not remounted.
      expect(screen.getByTestId("primary")).toBe(primary);
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
        "520",
      );
    });
  });
});
