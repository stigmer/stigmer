import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyedSubmission } from "../useKeyedSubmission";

describe("useKeyedSubmission", () => {
  it("tracks a key while its operation is in flight, then releases it", async () => {
    let resolve!: () => void;
    const { result } = renderHook(() => useKeyedSubmission<void>());

    let pending: Promise<void>;
    act(() => {
      pending = result.current.run("k-1", () => new Promise<void>((r) => (resolve = r)));
    });

    expect(result.current.submittingKeys.has("k-1")).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });

    expect(result.current.submittingKeys.size).toBe(0);
  });

  it("records a failure keyed, releases the in-flight key, then rethrows", async () => {
    const { result } = renderHook(() => useKeyedSubmission<void>());

    await act(async () => {
      await expect(
        result.current.run("k-1", () => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom");
    });

    expect(result.current.errorsByKey.get("k-1")?.message).toBe("boom");
    expect(result.current.submittingKeys.size).toBe(0);
  });

  it("coerces a non-Error rejection into an Error", async () => {
    const { result } = renderHook(() => useKeyedSubmission<void>());

    await act(async () => {
      await expect(
        result.current.run("k-1", () => Promise.reject("plain string")),
      ).rejects.toBe("plain string");
    });

    const recorded = result.current.errorsByKey.get("k-1");
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded?.message).toBe("plain string");
  });

  it("keys two failures independently — one never clobbers another", async () => {
    const { result } = renderHook(() => useKeyedSubmission<void>());

    await act(async () => {
      await expect(
        result.current.run("k-a", () => Promise.reject(new Error("fail-a"))),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.run("k-b", () => Promise.reject(new Error("fail-b"))),
      ).rejects.toThrow("fail-b");
    });

    expect(result.current.errorsByKey.get("k-a")?.message).toBe("fail-a");
    expect(result.current.errorsByKey.get("k-b")?.message).toBe("fail-b");
  });

  it("clears a key's prior error at retry-start, leaving siblings untouched", async () => {
    const { result } = renderHook(() => useKeyedSubmission<void>());

    await act(async () => {
      await expect(
        result.current.run("k-a", () => Promise.reject(new Error("fail-a"))),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.run("k-b", () => Promise.reject(new Error("fail-b"))),
      ).rejects.toThrow("fail-b");
    });

    // Retrying k-a succeeds: its error clears at run-start; k-b's persists.
    await act(async () => {
      await result.current.run("k-a", () => Promise.resolve());
    });

    expect(result.current.errorsByKey.has("k-a")).toBe(false);
    expect(result.current.errorsByKey.get("k-b")?.message).toBe("fail-b");
  });

  it("returns the resolved value on success", async () => {
    const { result } = renderHook(() => useKeyedSubmission<number>());

    let value: number | undefined;
    await act(async () => {
      value = await result.current.run("k-1", () => Promise.resolve(42));
    });

    expect(value).toBe(42);
    expect(result.current.errorsByKey.size).toBe(0);
  });

  it("clearErrors resets every recorded error", async () => {
    const { result } = renderHook(() => useKeyedSubmission<void>());

    await act(async () => {
      await expect(
        result.current.run("k-a", () => Promise.reject(new Error("fail-a"))),
      ).rejects.toThrow("fail-a");
    });
    expect(result.current.errorsByKey.size).toBe(1);

    act(() => result.current.clearErrors());
    expect(result.current.errorsByKey.size).toBe(0);
  });

  it("keeps a stable return reference across renders when nothing changes", () => {
    const { result, rerender } = renderHook(() => useKeyedSubmission<void>());

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
