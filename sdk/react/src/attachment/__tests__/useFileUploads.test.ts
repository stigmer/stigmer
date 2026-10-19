/**
 * useFileUploads: the chat box's files become Stigmer Files.
 *
 * Pins where a File goes (into the conversation with a session id, the
 * person's own before the first message), that the browser `File` is
 * handed over as it is so a large one streams, that a chip removed or
 * cleared before sending deletes its File, and that a hand-off deletes
 * nothing until `release`, which deletes only the person's own Files,
 * once. The `preparing` phase (stigmer/stigmer#369) keeps its contract:
 * an entry exists from the instant a paste is added, size is judged on
 * the prepared bytes, and a cancelled preparation never uploads. The
 * chat box holds at most MAX_MESSAGE_FILES files, the most a message
 * carries; a file past it is refused before it uploads.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));
vi.mock("../prepare-image.js", () => ({
  prepareImageForVision: vi.fn(),
}));

import { useStigmer } from "../../hooks";
import { prepareImageForVision } from "../prepare-image.js";
import { MAX_MESSAGE_FILES, useFileUploads } from "../useFileUploads.js";
import { MAX_ATTACHMENT_BYTES } from "../attachment-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFile(name: string, sizeBytes: number, type = "image/png"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

/** A file that reports `sizeBytes` without allocating it. */
function makeSizedFile(name: string, sizeBytes: number, type = "image/png"): File {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

/** A File record as `stigmer.file.uploadFile` answers it. */
function uploaded(id: string, sessionId = "") {
  return { metadata: { id }, status: { sessionId } };
}

/** Wires useStigmer to a File client whose uploads answer one id each, in order. */
function mockStigmer(sessionId = "") {
  let n = 0;
  const uploadFile = vi.fn().mockImplementation(() => Promise.resolve(uploaded(`file_${++n}`, sessionId)));
  const deleteFile = vi.fn().mockResolvedValue({});
  vi.mocked(useStigmer).mockReturnValue({
    file: { uploadFile, delete: deleteFile },
  } as unknown as ReturnType<typeof useStigmer>);
  return { uploadFile, deleteFile };
}

const prepareMock = vi.mocked(prepareImageForVision);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Where a File goes, and what happens to it
// ---------------------------------------------------------------------------

describe("useFileUploads — Files", () => {
  it("uploads into the conversation when a session id is given, handing over the browser File itself", async () => {
    const { uploadFile } = mockStigmer("ses_1");
    const picked = makeFile("ledger.csv", 64, "text/csv");

    const { result } = renderHook(() => useFileUploads({ org: "acme", sessionId: "ses_1" }));
    act(() => {
      result.current.addFiles([picked]);
    });

    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));
    expect(uploadFile).toHaveBeenCalledWith({
      org: "acme",
      sessionId: "ses_1",
      filename: "ledger.csv",
      mimeType: "text/csv",
      content: picked,
    });
    expect(result.current.entries[0]).toMatchObject({ fileId: "file_1", inConversation: true });
    expect(result.current.toFileIds()).toEqual(["file_1"]);
  });

  it("before the first message, uploads the person's own File and deletes it only on release, once", async () => {
    const { uploadFile, deleteFile } = mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32), makeFile("notes.md", 16, "text/markdown")]);
    });
    await waitFor(() => expect(result.current.allReady).toBe(true));
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ org: "acme", sessionId: undefined });

    let handOff!: ReturnType<typeof result.current.handOff>;
    act(() => {
      handOff = result.current.handOff();
    });

    // The chat box empties, and nothing is deleted before the run exists.
    expect(result.current.entries).toHaveLength(0);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(handOff.fileIds).toEqual(["file_1", "file_2"]);
    expect(handOff.attachments).toEqual([
      { fileId: "file_1", filename: "shot.png", kind: "image" },
      { fileId: "file_2", filename: "notes.md", kind: "document" },
    ]);

    await handOff.release();
    await handOff.release();
    expect(deleteFile.mock.calls.map((call) => call[0])).toEqual(["file_1", "file_2"]);
  });

  it("keeps the conversation's Files on release", async () => {
    const { deleteFile } = mockStigmer("ses_1");

    const { result } = renderHook(() => useFileUploads({ org: "acme", sessionId: "ses_1" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    await waitFor(() => expect(result.current.allReady).toBe(true));

    await act(async () => {
      await result.current.handOff().release();
    });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("hands off only ready Files, dropping a failed one", async () => {
    const { uploadFile } = mockStigmer();
    uploadFile.mockResolvedValueOnce(uploaded("file_ok")).mockRejectedValueOnce(new Error("refused"));

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("a.png", 8), makeFile("b.png", 8)]);
    });
    await waitFor(() => expect(result.current.entries[1].phase).toBe("error"));

    let fileIds: string[] = [];
    act(() => {
      fileIds = result.current.handOff().fileIds;
    });
    expect(fileIds).toEqual(["file_ok"]);
  });

  it("deletes a ready File when its chip is removed", async () => {
    const { deleteFile } = mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));

    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
    });
    expect(result.current.entries).toHaveLength(0);
    expect(deleteFile).toHaveBeenCalledWith("file_1");
  });

  it("deletes the File that arrives for a chip removed mid-upload", async () => {
    const { uploadFile, deleteFile } = mockStigmer();
    const gap = deferred<ReturnType<typeof uploaded>>();
    uploadFile.mockReturnValueOnce(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
    });

    await act(async () => {
      gap.resolve(uploaded("file_late"));
      await gap.promise;
    });
    expect(result.current.entries).toHaveLength(0);
    expect(deleteFile).toHaveBeenCalledWith("file_late");
  });

  it("clear() removes every chip and deletes every File", async () => {
    const { deleteFile } = mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("a.png", 8), makeFile("b.png", 8)]);
    });
    await waitFor(() => expect(result.current.allReady).toBe(true));

    act(() => {
      result.current.clear();
    });
    expect(result.current.hasEntries).toBe(false);
    expect(deleteFile.mock.calls.map((call) => call[0]).sort()).toEqual(["file_1", "file_2"]);
  });

  it("fails an upload without an organization, and a retry with one succeeds", async () => {
    const { uploadFile } = mockStigmer();

    const { result, rerender } = renderHook(({ org }: { org?: string }) => useFileUploads({ org }), {
      initialProps: {},
    });
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    await waitFor(() => expect(result.current.entries[0].phase).toBe("error"));
    expect(result.current.entries[0].error).toMatch(/organization/);
    expect(uploadFile).not.toHaveBeenCalled();

    rerender({ org: "acme" });
    act(() => {
      result.current.retryEntry(result.current.entries[0].id);
    });
    expect(result.current.entries[0].phase).toBe("uploading");
    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));
    expect(result.current.entries[0].fileId).toBe("file_1");
  });

  it("drops a failure that lands after its chip was removed", async () => {
    const { uploadFile } = mockStigmer();
    const gap = deferred<ReturnType<typeof uploaded>>();
    uploadFile.mockReturnValueOnce(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
    });
    await act(async () => {
      gap.reject(new Error("refused"));
      await gap.promise.catch(() => undefined);
    });
    expect(result.current.entries).toHaveLength(0);
  });

  it("swallows a failed delete: the chip goes, and release still settles", async () => {
    const { deleteFile } = mockStigmer();
    deleteFile.mockRejectedValue(new Error("already gone"));

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("a.png", 8), makeFile("b.png", 8)]);
    });
    await waitFor(() => expect(result.current.allReady).toBe(true));

    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
    });
    let release!: () => Promise<void>;
    act(() => {
      release = result.current.handOff().release;
    });
    await expect(release()).resolves.toBeUndefined();
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });

  it("retries only a failed entry", async () => {
    const { uploadFile } = mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 32)]);
    });
    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));

    act(() => {
      result.current.retryEntry(result.current.entries[0].id);
      result.current.retryEntry("no-such-entry");
    });
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("renames a second file of the same name before upload", async () => {
    const { uploadFile } = mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));
    act(() => {
      result.current.addFiles([makeFile("shot.png", 8), makeFile("shot.png", 8)]);
    });
    await waitFor(() => expect(result.current.allReady).toBe(true));
    expect(uploadFile.mock.calls.map((call) => (call[0] as { filename: string }).filename)).toEqual([
      "shot.png",
      "shot-2.png",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The most Files a message carries
// ---------------------------------------------------------------------------

/** `count` small files named `<prefix>1.png` onward. */
function makeFiles(count: number, prefix = "f"): File[] {
  return Array.from({ length: count }, (_, i) => makeFile(`${prefix}${i + 1}.png`, 8));
}

describe("useFileUploads — the message cap", () => {
  it("accepts and uploads exactly MAX_MESSAGE_FILES files", async () => {
    const { uploadFile } = mockStigmer();
    const onValidationError = vi.fn();

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));
    act(() => {
      result.current.addFiles(makeFiles(MAX_MESSAGE_FILES));
    });

    await waitFor(() => expect(result.current.allReady).toBe(true));
    expect(MAX_MESSAGE_FILES).toBe(20);
    expect(result.current.entries).toHaveLength(20);
    expect(uploadFile).toHaveBeenCalledTimes(20);
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("refuses the file past the cap before it uploads, and says why", async () => {
    const { uploadFile } = mockStigmer();
    const onValidationError = vi.fn();

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));
    act(() => {
      result.current.addFiles(makeFiles(MAX_MESSAGE_FILES + 1));
    });

    await waitFor(() => expect(result.current.allReady).toBe(true));
    expect(result.current.entries.map((e) => e.file.name)).not.toContain("f21.png");
    expect(uploadFile).toHaveBeenCalledTimes(20);
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(onValidationError).toHaveBeenCalledWith("A message carries at most 20 files; 1 file was not added.");
  });

  it("counts the files already in the chat box, in any phase, and frees a slot on removal", async () => {
    const { uploadFile } = mockStigmer();
    prepareMock.mockReturnValue(new Promise(() => {}));
    const onValidationError = vi.fn();

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));
    act(() => {
      result.current.addFiles(makeFiles(MAX_MESSAGE_FILES - 1));
      result.current.addFiles([makeFile("pasted.png", 8)], { prepareImages: true });
    });
    act(() => {
      result.current.addFiles(makeFiles(2, "late"));
    });

    expect(result.current.entries).toHaveLength(20);
    expect(onValidationError).toHaveBeenCalledWith("A message carries at most 20 files; 2 files were not added.");

    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
      result.current.addFiles([makeFile("again.png", 8)]);
    });
    expect(result.current.entries).toHaveLength(20);
    expect(result.current.entries.at(-1)?.file.name).toBe("again.png");
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(20));
  });
});

// ---------------------------------------------------------------------------
// The preparing phase
// ---------------------------------------------------------------------------

describe("useFileUploads — prepareImages lifecycle", () => {
  it("shows the entry immediately in the preparing phase, gating submit", () => {
    mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], { prepareImages: true });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].phase).toBe("preparing");
    expect(result.current.entries[0].file.name).toBe("shot.png");
    expect(result.current.isPreparing).toBe(true);
    // preparing gates exactly like uploading: the silent-drop guard.
    expect(result.current.isUploading).toBe(true);
    expect(result.current.allReady).toBe(false);
  });

  it("swaps to the prepared file (name, type) and uploads it", async () => {
    const { uploadFile } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    act(() => {
      result.current.addFiles([makeFile("shot.png", 4096)], { prepareImages: true });
    });
    const prepared = makeFile("shot.jpg", 2048, "image/jpeg");
    act(() => {
      gap.resolve(prepared);
    });

    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));
    expect(result.current.entries[0].file.name).toBe("shot.jpg");
    expect(result.current.entries[0].contentType).toBe("image/jpeg");
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ filename: "shot.jpg", mimeType: "image/jpeg", content: prepared });
  });

  it("accepts a raw file over the size limit when preparation brings it under (the #369 paste contract)", async () => {
    const { uploadFile } = mockStigmer();
    const onValidationError = vi.fn();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));

    act(() => {
      result.current.addFiles([makeSizedFile("huge-screenshot.png", MAX_ATTACHMENT_BYTES + 1)], {
        prepareImages: true,
      });
    });
    expect(result.current.entries[0].phase).toBe("preparing");

    act(() => {
      gap.resolve(makeFile("huge-screenshot.png", 512));
    });

    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));
    expect(onValidationError).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("removes the entry and reports via onValidationError when still oversized after preparation", async () => {
    const { uploadFile } = mockStigmer();
    const onValidationError = vi.fn();
    const oversized = makeSizedFile("giant.zip", MAX_ATTACHMENT_BYTES + 1, "application/zip");
    // Non-image passthrough: preparation returns the original untouched.
    prepareMock.mockResolvedValue(oversized);

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));

    act(() => {
      result.current.addFiles([oversized], { prepareImages: true });
    });
    expect(result.current.entries).toHaveLength(1);

    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(onValidationError).toHaveBeenCalledWith(expect.stringContaining("giant.zip"));
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("discards the preparation result when the entry is removed mid-preparation", async () => {
    const { uploadFile, deleteFile } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], { prepareImages: true });
    });
    act(() => {
      result.current.removeEntry(result.current.entries[0].id);
    });
    expect(result.current.entries).toHaveLength(0);

    // Late completion must not resurrect the entry or start an upload.
    await act(async () => {
      gap.resolve(makeFile("shot.jpg", 512, "image/jpeg"));
      await gap.promise;
    });
    expect(result.current.entries).toHaveLength(0);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("discards the preparation result on clear()", async () => {
    const { uploadFile } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], { prepareImages: true });
    });
    act(() => {
      result.current.clear();
    });

    await act(async () => {
      gap.resolve(makeFile("shot.jpg", 512, "image/jpeg"));
      await gap.promise;
    });
    expect(result.current.entries).toHaveLength(0);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("uniquifies the prepared name against other entries' settled names", async () => {
    mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    // A settled entry already owns "pasted-image.png".
    act(() => {
      result.current.addFiles([makeFile("pasted-image.png", 256)]);
    });
    // The prepared file lands on the same name.
    act(() => {
      result.current.addFiles([makeFile("other.png", 256)], { prepareImages: true });
    });
    act(() => {
      gap.resolve(makeFile("pasted-image.png", 128));
    });

    await waitFor(() => expect(result.current.entries[1].phase).toBe("ready"));
    expect(result.current.entries[1].file.name).toBe("pasted-image-2.png");
  });
});

// ---------------------------------------------------------------------------
// The unflagged path
// ---------------------------------------------------------------------------

describe("useFileUploads — unflagged addFiles", () => {
  it("never enters the preparing phase and never calls prepareImageForVision", async () => {
    mockStigmer();

    const { result } = renderHook(() => useFileUploads({ org: "acme" }));

    act(() => {
      result.current.addFiles([makeFile("picked.png", 1024)]);
    });

    expect(result.current.entries[0].phase).toBe("uploading");
    expect(result.current.isPreparing).toBe(false);
    expect(prepareMock).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.entries[0].phase).toBe("ready"));
  });

  it("still validates size up front and rejects without creating an entry", () => {
    const { uploadFile } = mockStigmer();
    const onValidationError = vi.fn();

    const { result } = renderHook(() => useFileUploads({ org: "acme", onValidationError }));

    act(() => {
      result.current.addFiles([makeSizedFile("too-big.png", MAX_ATTACHMENT_BYTES + 1)]);
    });

    expect(result.current.entries).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledWith(expect.stringContaining("500 MB"));
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
