import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspaceFileContent } from "../useWorkspaceFileContent";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type {
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "../WorkspaceFileReader";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function gitEntry(id = "e1"): WorkspaceEntry {
  return {
    id,
    name: "acme/repo",
    type: "git",
    gitUrl: "https://github.com/acme/repo",
    gitBranch: "main",
  };
}

function textContent(text: string): WorkspaceFileContent {
  return { text, isBinary: false, size: text.length, encoding: "utf-8" };
}

// ---------------------------------------------------------------------------
// useWorkspaceFileContent
// ---------------------------------------------------------------------------

describe("useWorkspaceFileContent", () => {
  it("resolves file content on success and is not unsupported", async () => {
    const reader: WorkspaceFileReader = vi.fn(async () => textContent("hello"));
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "a.ts", reader }),
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.content?.text).toBe("hello");
    expect(result.current.isUnsupported).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports isUnsupported when the reader resolves null", async () => {
    const reader: WorkspaceFileReader = vi.fn(async () => null);
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "a.ts", reader }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.content).toBeNull();
    expect(result.current.isUnsupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a reader throw as error, not unsupported", async () => {
    const reader: WorkspaceFileReader = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "a.ts", reader }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isUnsupported).toBe(false);
    expect(result.current.content).toBeNull();
  });

  it("stays idle and unsupported when no reader is injected", () => {
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "a.ts", reader: undefined }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isUnsupported).toBe(true);
    expect(result.current.content).toBeNull();
  });

  it("does not treat a binary file (present object, text null) as unsupported", async () => {
    const binary: WorkspaceFileContent = {
      text: null,
      isBinary: true,
      size: 10,
      encoding: "unknown",
    };
    const reader: WorkspaceFileReader = vi.fn(async () => binary);
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "img.png", reader }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.content).toEqual(binary);
    expect(result.current.isUnsupported).toBe(false);
  });

  it("stays idle and never calls the reader when no file is selected", () => {
    const reader = vi.fn(async () => textContent("x")) as WorkspaceFileReader;
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: null, path: null, reader }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isUnsupported).toBe(false);
    expect(reader).not.toHaveBeenCalled();
  });

  it("re-reads on refetch()", async () => {
    let n = 0;
    const reader: WorkspaceFileReader = vi.fn(async () => textContent(`v${++n}`));
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ entry: gitEntry(), path: "a.ts", reader }),
    );

    await waitFor(() => expect(result.current.content?.text).toBe("v1"));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.content?.text).toBe("v2"));
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("re-reads when the path changes", async () => {
    const reader: WorkspaceFileReader = vi.fn(async (_e, p) =>
      textContent(`content:${p}`),
    );
    const { result, rerender } = renderHook(
      (props: { path: string }) =>
        useWorkspaceFileContent({ entry: gitEntry(), path: props.path, reader }),
      { initialProps: { path: "a.ts" } },
    );

    await waitFor(() => expect(result.current.content?.text).toBe("content:a.ts"));

    rerender({ path: "b.ts" });

    await waitFor(() => expect(result.current.content?.text).toBe("content:b.ts"));
  });

  it("ignores a stale slow read when the path changes mid-flight", async () => {
    const deferred = new Map<string, (v: WorkspaceFileContent) => void>();
    const reader: WorkspaceFileReader = (_e, p) =>
      new Promise((resolve) => deferred.set(p, resolve));

    const { result, rerender } = renderHook(
      (props: { path: string }) =>
        useWorkspaceFileContent({ entry: gitEntry(), path: props.path, reader }),
      { initialProps: { path: "slow.ts" } },
    );

    // Switch to a second file before the first resolves.
    rerender({ path: "fast.ts" });

    // Resolve the current (fast) read first.
    await act(async () => {
      deferred.get("fast.ts")!(textContent("FAST"));
    });
    await waitFor(() => expect(result.current.content?.text).toBe("FAST"));

    // The stale (slow) read resolves later — it must NOT overwrite FAST.
    await act(async () => {
      deferred.get("slow.ts")!(textContent("SLOW"));
    });
    expect(result.current.content?.text).toBe("FAST");
  });

  it("goes idle when the entry is removed (entry -> null)", async () => {
    const reader: WorkspaceFileReader = vi.fn(async () => textContent("x"));
    const { result, rerender } = renderHook(
      (props: { entry: WorkspaceEntry | null }) =>
        useWorkspaceFileContent({ entry: props.entry, path: "a.ts", reader }),
      { initialProps: { entry: gitEntry() as WorkspaceEntry | null } },
    );

    await waitFor(() => expect(result.current.content?.text).toBe("x"));

    rerender({ entry: null });

    await waitFor(() => expect(result.current.content).toBeNull());
    expect(result.current.isLoading).toBe(false);
  });
});
