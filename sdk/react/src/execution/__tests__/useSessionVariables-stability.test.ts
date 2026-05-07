import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionVariables } from "../useSessionVariables";

describe("useSessionVariables — return reference stability", () => {
  it("returns the same object reference across re-renders when state is unchanged", () => {
    const { result, rerender } = renderHook(() => useSessionVariables());

    const first = result.current;
    rerender();
    const second = result.current;

    expect(second).toBe(first);
  });

  it("returns a new reference after adding an entry", () => {
    const { result } = renderHook(() => useSessionVariables());

    const before = result.current;

    act(() => {
      result.current.addEntry();
    });

    expect(result.current).not.toBe(before);
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.isEmpty).toBe(false);
  });

  it("stabilizes after mutation — re-renders without state change preserve reference", () => {
    const { result, rerender } = renderHook(() => useSessionVariables());

    act(() => {
      result.current.addEntry();
    });

    const afterAdd = result.current;
    rerender();

    expect(result.current).toBe(afterAdd);
  });

  it("callback references are stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useSessionVariables());

    const { addEntry, removeEntry, updateEntry, clear, toRuntimeEnv, toSaveForFutureEnv } =
      result.current;

    rerender();

    expect(result.current.addEntry).toBe(addEntry);
    expect(result.current.removeEntry).toBe(removeEntry);
    expect(result.current.updateEntry).toBe(updateEntry);
    expect(result.current.clear).toBe(clear);
    expect(result.current.toRuntimeEnv).toBe(toRuntimeEnv);
    expect(result.current.toSaveForFutureEnv).toBe(toSaveForFutureEnv);
  });

  it("returns a new reference after clearing", () => {
    const { result } = renderHook(() => useSessionVariables());

    act(() => {
      result.current.addEntry();
    });

    const withEntry = result.current;

    act(() => {
      result.current.clear();
    });

    expect(result.current).not.toBe(withEntry);
    expect(result.current.isEmpty).toBe(true);
  });

  it("derived booleans update correctly on state change", () => {
    const { result } = renderHook(() => useSessionVariables());

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasValidEntries).toBe(false);

    act(() => {
      result.current.addEntry();
    });

    const entryId = result.current.entries[0].id;

    act(() => {
      result.current.updateEntry(entryId, { key: "API_KEY", value: "secret123" });
    });

    expect(result.current.isEmpty).toBe(false);
    expect(result.current.hasValidEntries).toBe(true);
  });
});
