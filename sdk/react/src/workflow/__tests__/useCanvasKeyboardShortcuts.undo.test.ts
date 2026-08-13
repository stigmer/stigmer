import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasKeyboardShortcuts } from "../useCanvasKeyboardShortcuts";
import type { UseCanvasKeyboardShortcutsOptions } from "../useCanvasKeyboardShortcuts";

// Keyboard undo/redo binding (moved here from useGraphHistory with the
// oss#588 fix so the shortcut routes through the orchestrator's
// canvas-syncing undo/redo instead of a raw model mutation).

let container: HTMLDivElement;

function makeOptions(
  overrides: Partial<UseCanvasKeyboardShortcutsOptions> = {},
): UseCanvasKeyboardShortcutsOptions {
  return {
    containerRef: { current: container },
    selection: null,
    duplicateNode: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    onRequestTaskPicker: vi.fn(),
    onDismiss: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
}

function pressModZ(target: EventTarget, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  container.tabIndex = -1;
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("useCanvasKeyboardShortcuts — undo/redo", () => {
  it("Mod+Z triggers undo when focus is inside the container", () => {
    const options = makeOptions();
    renderHook(() => useCanvasKeyboardShortcuts(options));

    container.focus();
    pressModZ(container);

    expect(options.undo).toHaveBeenCalledTimes(1);
    expect(options.redo).not.toHaveBeenCalled();
  });

  it("Mod+Shift+Z triggers redo when focus is inside the container", () => {
    const options = makeOptions();
    renderHook(() => useCanvasKeyboardShortcuts(options));

    container.focus();
    pressModZ(container, true);

    expect(options.redo).toHaveBeenCalledTimes(1);
    expect(options.undo).not.toHaveBeenCalled();
  });

  it("Mod+Z does nothing when focus is outside the container", () => {
    const options = makeOptions();
    renderHook(() => useCanvasKeyboardShortcuts(options));

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    pressModZ(outside);

    expect(options.undo).not.toHaveBeenCalled();
    outside.remove();
  });

  it("Mod+Z in a text input inside the container keeps native text undo", () => {
    const options = makeOptions();
    renderHook(() => useCanvasKeyboardShortcuts(options));

    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();
    pressModZ(input);

    expect(options.undo).not.toHaveBeenCalled();
  });

  it("Ctrl+Z (non-Mac modifier) also triggers undo", () => {
    const options = makeOptions();
    renderHook(() => useCanvasKeyboardShortcuts(options));

    container.focus();
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(options.undo).toHaveBeenCalledTimes(1);
  });
});
