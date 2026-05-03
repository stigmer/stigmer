import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceEntries } from "../useWorkspaceEntries";

describe("useWorkspaceEntries — return reference stability", () => {
  it("returns the same object reference across re-renders when state is unchanged", () => {
    const { result, rerender } = renderHook(() => useWorkspaceEntries());

    const first = result.current;
    rerender();
    const second = result.current;

    expect(second).toBe(first);
  });

  it("returns a new reference after adding an entry", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    const before = result.current;

    act(() => {
      result.current.addGitRepo("https://github.com/acme/repo.git", "main");
    });

    expect(result.current).not.toBe(before);
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.hasEntries).toBe(true);
  });

  it("stabilizes after add — re-renders without state change preserve reference", () => {
    const { result, rerender } = renderHook(() => useWorkspaceEntries());

    act(() => {
      result.current.addGitRepo("https://github.com/acme/repo.git");
    });

    const after = result.current;
    rerender();

    expect(result.current).toBe(after);
  });

  it("callback references are stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useWorkspaceEntries());

    const { addGitRepo, addLocalPath, remove, clear, clearLocal, toInput } = result.current;

    rerender();

    expect(result.current.addGitRepo).toBe(addGitRepo);
    expect(result.current.addLocalPath).toBe(addLocalPath);
    expect(result.current.remove).toBe(remove);
    expect(result.current.clear).toBe(clear);
    expect(result.current.clearLocal).toBe(clearLocal);
    expect(result.current.toInput).toBe(toInput);
  });

  it("returns a new reference after removing an entry", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => {
      result.current.addLocalPath("/home/dev/project");
    });

    const withEntry = result.current;
    const entryId = withEntry.entries[0].id;

    act(() => {
      result.current.remove(entryId);
    });

    expect(result.current).not.toBe(withEntry);
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.hasEntries).toBe(false);
  });
});
