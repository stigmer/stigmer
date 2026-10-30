/**
 * The File hooks over `stigmer.file`: useFile reads a File's record by id
 * and stays idle without one; useFileDownloadUrl mints a link only while
 * enabled; useFileDownload mints a fresh link per click, saves it under the
 * name given, and surfaces a failed mint as its error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { useFile, useFileDownload, useFileDownloadUrl } from "../useFile";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(file: { get?: ReturnType<typeof vi.fn>; getDownloadUrl?: ReturnType<typeof vi.fn> }) {
  return { file } as unknown as Stigmer;
}

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("useFile", () => {
  it("reads the File's record by id", async () => {
    const record = { spec: { filename: "ledger.xlsx" }, status: { sizeBytes: 2048n } };
    const get = vi.fn().mockResolvedValue(record);
    const { result } = renderHook(() => useFile("file_1"), { wrapper: wrapperFor(makeStigmer({ get })) });

    await waitFor(() => expect(result.current.file).toBe(record));
    expect(get).toHaveBeenCalledWith("file_1");
    expect(result.current.error).toBeNull();
  });

  it("stays idle without an id", () => {
    const get = vi.fn();
    const { result } = renderHook(() => useFile(null), { wrapper: wrapperFor(makeStigmer({ get })) });

    expect(result.current.file).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useFileDownloadUrl", () => {
  it("mints a link while enabled, and none while disabled", async () => {
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://files.example/1" });
    const stigmer = makeStigmer({ getDownloadUrl });

    const disabled = renderHook(() => useFileDownloadUrl("file_1", { enabled: false }), {
      wrapper: wrapperFor(stigmer),
    });
    expect(disabled.result.current.url).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();

    const enabled = renderHook(() => useFileDownloadUrl("file_1"), { wrapper: wrapperFor(stigmer) });
    await waitFor(() => expect(enabled.result.current.url).toBe("https://files.example/1"));
    expect(getDownloadUrl).toHaveBeenCalledWith("file_1");
  });
});

describe("useFileDownload", () => {
  it("mints a fresh link at click time and saves it under the name given", async () => {
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "https://files.example/1" });
    const { result } = renderHook(() => useFileDownload(), {
      wrapper: wrapperFor(makeStigmer({ getDownloadUrl })),
    });
    // Spied after render, so only the download's own anchor is caught.
    const appended: HTMLAnchorElement[] = [];
    const append = vi.spyOn(document.body, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
      appended.push(node as unknown as HTMLAnchorElement);
      return node;
    });
    const remove = vi.spyOn(document.body, "removeChild").mockImplementation(<T extends Node>(node: T): T => node);

    await act(async () => {
      await result.current.download("file_1", "ledger.xlsx");
    });

    expect(getDownloadUrl).toHaveBeenCalledWith("file_1");
    expect(appended[0]?.href).toBe("https://files.example/1");
    expect(appended[0]?.download).toBe("ledger.xlsx");
    expect(result.current.isDownloading).toBe(false);
    append.mockRestore();
    remove.mockRestore();
  });

  it("ignores a second click while a download is starting", async () => {
    let answer!: (value: { url: string }) => void;
    const getDownloadUrl = vi.fn(() => new Promise<{ url: string }>((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useFileDownload(), {
      wrapper: wrapperFor(makeStigmer({ getDownloadUrl })),
    });

    let first!: Promise<void>;
    act(() => {
      first = result.current.download("file_1");
    });
    expect(result.current.isDownloading).toBe(true);
    await act(async () => {
      await result.current.download("file_1");
    });
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ url: "" });
      await first;
    });
    expect(result.current.isDownloading).toBe(false);
  });

  it("surfaces a failed mint as its error", async () => {
    const getDownloadUrl = vi.fn().mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useFileDownload(), {
      wrapper: wrapperFor(makeStigmer({ getDownloadUrl })),
    });

    await act(async () => {
      await result.current.download("file_1");
    });

    expect(result.current.error?.message).toBe("gone");
    expect(result.current.isDownloading).toBe(false);
  });
});
