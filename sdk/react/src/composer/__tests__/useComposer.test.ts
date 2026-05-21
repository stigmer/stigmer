import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComposer } from "../useComposer";
import type { KeyboardEvent } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyEvent(
  key: string,
  opts?: { shiftKey?: boolean },
): KeyboardEvent<HTMLTextAreaElement> {
  const prevented = { current: false };
  return {
    key,
    shiftKey: opts?.shiftKey ?? false,
    preventDefault: () => {
      prevented.current = true;
    },
    get defaultPrevented() {
      return prevented.current;
    },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useComposer", () => {
  it("returns initial state with empty message and canSubmit false", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    expect(result.current.message).toBe("");
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.textareaProps.disabled).toBe(false);
    expect(result.current.textareaProps.value).toBe("");
  });

  it("canSubmit becomes true when message is non-empty", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("hello");
    });

    expect(result.current.canSubmit).toBe(true);
    expect(result.current.message).toBe("hello");
  });

  it("canSubmit remains false when message is whitespace-only", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("   ");
    });

    expect(result.current.canSubmit).toBe(false);
  });

  it("canSubmit is false when disabled regardless of message", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useComposer({ onSubmit, disabled: true }),
    );

    act(() => {
      result.current.setMessage("hello");
    });

    expect(result.current.canSubmit).toBe(false);
    expect(result.current.textareaProps.disabled).toBe(true);
  });

  it("submit calls onSubmit with trimmed message and clears", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("  hello  ");
    });

    act(() => {
      result.current.submit();
    });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(result.current.message).toBe("");
    expect(result.current.canSubmit).toBe(false);
  });

  it("submit is a no-op when canSubmit is false", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.submit();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("textareaProps.onKeyDown submits on Enter", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("hello");
    });

    const event = makeKeyEvent("Enter");

    act(() => {
      result.current.textareaProps.onKeyDown(event);
    });

    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(event.defaultPrevented).toBe(true);
  });

  it("textareaProps.onKeyDown does NOT submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("hello");
    });

    const event = makeKeyEvent("Enter", { shiftKey: true });

    act(() => {
      result.current.textareaProps.onKeyDown(event);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("textareaProps.onKeyDown prevents default on Enter", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("test");
    });

    const event = makeKeyEvent("Enter");

    act(() => {
      result.current.textareaProps.onKeyDown(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("clear resets message to empty string", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposer({ onSubmit }));

    act(() => {
      result.current.setMessage("hello");
    });

    expect(result.current.message).toBe("hello");

    act(() => {
      result.current.clear();
    });

    expect(result.current.message).toBe("");
    expect(result.current.canSubmit).toBe(false);
  });

  it("textareaProps.disabled reflects the disabled option", () => {
    const onSubmit = vi.fn();
    const { result, rerender } = renderHook(
      ({ disabled }) => useComposer({ onSubmit, disabled }),
      { initialProps: { disabled: false } },
    );

    expect(result.current.textareaProps.disabled).toBe(false);

    rerender({ disabled: true });

    expect(result.current.textareaProps.disabled).toBe(true);
  });
});
