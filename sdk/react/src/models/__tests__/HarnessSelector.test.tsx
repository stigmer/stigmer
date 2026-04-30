import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HarnessSelector } from "../HarnessSelector";

function renderSelector(
  overrides: Partial<Parameters<typeof HarnessSelector>[0]> = {},
) {
  const onValueChange = overrides.onValueChange ?? vi.fn();
  const result = render(
    <HarnessSelector
      value={overrides.value ?? "native"}
      onValueChange={onValueChange}
      disabled={overrides.disabled}
      className={overrides.className}
    />,
  );
  return { ...result, onValueChange };
}

afterEach(cleanup);

describe("HarnessSelector", () => {
  describe("ARIA structure", () => {
    it("renders a radiogroup with correct aria-label", () => {
      renderSelector();
      const group = screen.getByRole("radiogroup", { name: "Execution engine" });
      expect(group).toBeDefined();
    });

    it("renders exactly two radio buttons", () => {
      renderSelector();
      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(2);
    });

    it("labels radio buttons with user-facing harness names", () => {
      renderSelector();
      expect(screen.getByRole("radio", { name: "Stigmer" })).toBeDefined();
      expect(screen.getByRole("radio", { name: "Cursor" })).toBeDefined();
    });
  });

  describe("checked state", () => {
    it("marks native as checked when value is native", () => {
      renderSelector({ value: "native" });
      const native = screen.getByRole("radio", { name: "Stigmer" });
      const cursor = screen.getByRole("radio", { name: "Cursor" });
      expect(native.getAttribute("aria-checked")).toBe("true");
      expect(cursor.getAttribute("aria-checked")).toBe("false");
    });

    it("marks cursor as checked when value is cursor", () => {
      renderSelector({ value: "cursor" });
      const native = screen.getByRole("radio", { name: "Stigmer" });
      const cursor = screen.getByRole("radio", { name: "Cursor" });
      expect(native.getAttribute("aria-checked")).toBe("false");
      expect(cursor.getAttribute("aria-checked")).toBe("true");
    });
  });

  describe("roving tabIndex", () => {
    it("sets tabIndex 0 on the active option and -1 on inactive", () => {
      renderSelector({ value: "native" });
      const native = screen.getByRole("radio", { name: "Stigmer" });
      const cursor = screen.getByRole("radio", { name: "Cursor" });
      expect(native.tabIndex).toBe(0);
      expect(cursor.tabIndex).toBe(-1);
    });

    it("reverses tabIndex when cursor is active", () => {
      renderSelector({ value: "cursor" });
      const native = screen.getByRole("radio", { name: "Stigmer" });
      const cursor = screen.getByRole("radio", { name: "Cursor" });
      expect(native.tabIndex).toBe(-1);
      expect(cursor.tabIndex).toBe(0);
    });
  });

  describe("click interaction", () => {
    it("fires onValueChange when clicking an inactive option", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      expect(onValueChange).toHaveBeenCalledWith("cursor");
    });

    it("does not fire onValueChange when clicking the active option", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      fireEvent.click(screen.getByRole("radio", { name: "Stigmer" }));
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowRight from native selects cursor", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowRight" });
      expect(onValueChange).toHaveBeenCalledWith("cursor");
    });

    it("ArrowLeft from native wraps to cursor", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowLeft" });
      expect(onValueChange).toHaveBeenCalledWith("cursor");
    });

    it("ArrowRight from cursor wraps to native", () => {
      const { onValueChange } = renderSelector({ value: "cursor" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowRight" });
      expect(onValueChange).toHaveBeenCalledWith("native");
    });

    it("ArrowDown behaves the same as ArrowRight", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowDown" });
      expect(onValueChange).toHaveBeenCalledWith("cursor");
    });

    it("ArrowUp behaves the same as ArrowLeft", () => {
      const { onValueChange } = renderSelector({ value: "cursor" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowUp" });
      expect(onValueChange).toHaveBeenCalledWith("native");
    });

    it("ignores non-arrow keys", () => {
      const { onValueChange } = renderSelector({ value: "native" });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "Enter" });
      fireEvent.keyDown(group, { key: " " });
      fireEvent.keyDown(group, { key: "Tab" });
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe("disabled state", () => {
    it("does not fire onValueChange on click when disabled", () => {
      const { onValueChange } = renderSelector({
        value: "native",
        disabled: true,
      });
      fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("does not fire onValueChange on keyboard when disabled", () => {
      const { onValueChange } = renderSelector({
        value: "native",
        disabled: true,
      });
      const group = screen.getByRole("radiogroup");
      fireEvent.keyDown(group, { key: "ArrowRight" });
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("marks both radio buttons as disabled", () => {
      renderSelector({ disabled: true });
      const radios = screen.getAllByRole("radio");
      for (const radio of radios) {
        expect((radio as HTMLButtonElement).disabled).toBe(true);
      }
    });
  });

  describe("premium indicator", () => {
    it("shows premium indicator on the cursor option", () => {
      renderSelector({ value: "native" });
      const premiumBadge = screen.getByLabelText("premium");
      expect(premiumBadge).toBeDefined();
      expect(premiumBadge.textContent).toBe("$$$");
    });

    it("does not show premium indicator on the native option", () => {
      renderSelector({ value: "native" });
      const premiumBadges = screen.getAllByLabelText("premium");
      expect(premiumBadges).toHaveLength(1);
    });
  });

  describe("className passthrough", () => {
    it("appends custom className to the root container", () => {
      renderSelector({ className: "my-custom-class" });
      const group = screen.getByRole("radiogroup");
      expect(group.className).toContain("my-custom-class");
    });
  });
});
