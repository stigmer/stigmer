import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileReferences } from "../useFileReferences";

describe("useFileReferences", () => {
  it("starts with empty refs and hasRefs false", () => {
    const { result } = renderHook(() => useFileReferences());

    expect(result.current.refs).toEqual([]);
    expect(result.current.hasRefs).toBe(false);
  });

  it("add() appends a path and sets hasRefs true", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("src/config.yaml");
    });

    expect(result.current.refs).toEqual(["src/config.yaml"]);
    expect(result.current.hasRefs).toBe(true);
  });

  it("add() deduplicates — same path added twice results in one entry", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("src/config.yaml");
      result.current.add("src/config.yaml");
    });

    expect(result.current.refs).toEqual(["src/config.yaml"]);
  });

  it("add() preserves insertion order", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("a.ts");
      result.current.add("b.ts");
      result.current.add("c.ts");
    });

    expect(result.current.refs).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("remove() removes an existing path", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("a.ts");
      result.current.add("b.ts");
    });

    act(() => {
      result.current.remove("a.ts");
    });

    expect(result.current.refs).toEqual(["b.ts"]);
    expect(result.current.hasRefs).toBe(true);
  });

  it("remove() is a no-op for non-existent paths (referential stability)", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("a.ts");
    });

    const refsBefore = result.current.refs;

    act(() => {
      result.current.remove("nonexistent.ts");
    });

    expect(result.current.refs).toBe(refsBefore);
  });

  it("clear() removes all refs", () => {
    const { result } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("a.ts");
      result.current.add("b.ts");
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.refs).toEqual([]);
    expect(result.current.hasRefs).toBe(false);
  });

  it("clear() on empty state preserves reference (no unnecessary re-render)", () => {
    const { result } = renderHook(() => useFileReferences());

    const refsBefore = result.current.refs;

    act(() => {
      result.current.clear();
    });

    expect(result.current.refs).toBe(refsBefore);
  });

  it("return value is referentially stable across renders when refs unchanged", () => {
    const { result, rerender } = renderHook(() => useFileReferences());

    act(() => {
      result.current.add("a.ts");
    });

    const returnBefore = result.current;
    rerender();

    expect(result.current.add).toBe(returnBefore.add);
    expect(result.current.remove).toBe(returnBefore.remove);
    expect(result.current.clear).toBe(returnBefore.clear);
  });
});
