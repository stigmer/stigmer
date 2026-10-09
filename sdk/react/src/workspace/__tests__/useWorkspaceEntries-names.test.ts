/**
 * useWorkspaceEntries keeps every entry name unique, because the server
 * refuses a workspace that repeats one: adding one repository at a second
 * branch names it after the branch, a further repeat takes a number, a
 * local folder repeat takes a number, and a removed entry frees its name.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceEntries } from "../useWorkspaceEntries";

describe("useWorkspaceEntries — unique entry names", () => {
  it("names a repository added at a second branch after that branch", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => result.current.addGitRepo("https://github.com/acme/api.git", "main"));
    act(() => result.current.addGitRepo("https://github.com/acme/api.git", "dev"));

    expect(result.current.entries.map((e) => e.name)).toEqual(["acme/api", "acme/api@dev"]);
    expect(result.current.toInput().map((e) => e.name)).toEqual(["acme/api", "acme/api@dev"]);
  });

  it("numbers a repeat whose branch-qualified name is taken or that has no branch", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => result.current.addGitRepo("https://github.com/acme/api", "dev"));
    act(() => result.current.addGitRepo("https://github.com/acme/api", "dev"));
    act(() => result.current.addGitRepo("https://github.com/acme/api", "dev"));
    act(() => result.current.addGitRepo("https://github.com/acme/api"));

    expect(result.current.entries.map((e) => e.name)).toEqual([
      "acme/api",
      "acme/api@dev",
      "acme/api-2",
      "acme/api-3",
    ]);
  });

  it("numbers a local folder repeat and keeps a stored name that is free", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => result.current.addLocalPath("/home/dev/api"));
    act(() => result.current.addLocalPath("/home/dev/api/"));
    act(() => result.current.addGitRepo("https://github.com/acme/api", "main", "backend"));

    expect(result.current.entries.map((e) => e.name)).toEqual(["dev/api", "dev/api-2", "backend"]);
  });

  it("frees a removed entry's name", () => {
    const { result } = renderHook(() => useWorkspaceEntries());

    act(() => result.current.addGitRepo("https://github.com/acme/api", "main"));
    act(() => result.current.remove(result.current.entries[0]!.id));
    act(() => result.current.addGitRepo("https://github.com/acme/api", "dev"));

    expect(result.current.entries.map((e) => e.name)).toEqual(["acme/api"]);
  });
});
