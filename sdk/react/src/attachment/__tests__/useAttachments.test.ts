/**
 * useAttachments lifecycle tests, centered on the `preparing` phase
 * (stigmer/stigmer#369): entries must exist from the instant a
 * prepare-flagged file is added, transition through preparation to
 * upload, and honor the deferred-validation and cancellation contracts
 * documented on {@link AddFilesOptions.prepareImages}.
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
import { useAttachments } from "../useAttachments.js";
import { MAX_ATTACHMENT_BYTES } from "../attachment-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeFile(name: string, sizeBytes: number, type = "image/png"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

/** Wires useStigmer to an uploadAttachment mock that resolves immediately. */
function mockStigmer() {
  const uploadAttachment = vi
    .fn()
    .mockResolvedValue({ storageKey: "attachments/test/key" });
  vi.mocked(useStigmer).mockReturnValue({
    agentExecution: { uploadAttachment },
  } as unknown as ReturnType<typeof useStigmer>);
  return { uploadAttachment };
}

const prepareMock = vi.mocked(prepareImageForVision);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The preparing phase
// ---------------------------------------------------------------------------

describe("useAttachments — prepareImages lifecycle", () => {
  it("shows the entry immediately in the preparing phase, gating submit", () => {
    mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useAttachments());

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], {
        prepareImages: true,
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].phase).toBe("preparing");
    expect(result.current.entries[0].file.name).toBe("shot.png");
    expect(result.current.isPreparing).toBe(true);
    // preparing gates exactly like uploading — the silent-drop guard.
    expect(result.current.isUploading).toBe(true);
    expect(result.current.allReady).toBe(false);
  });

  it("swaps to the prepared file (name, type) and proceeds to upload → ready", async () => {
    const { uploadAttachment } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useAttachments());

    act(() => {
      result.current.addFiles([makeFile("shot.png", 4096)], {
        prepareImages: true,
      });
    });

    // Preparation re-encoded to JPEG: name and MIME follow.
    act(() => {
      gap.resolve(makeFile("shot.jpg", 2048, "image/jpeg"));
    });

    await waitFor(() => {
      expect(result.current.entries[0].phase).toBe("ready");
    });
    expect(result.current.entries[0].file.name).toBe("shot.jpg");
    expect(result.current.entries[0].contentType).toBe("image/jpeg");
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(result.current.toAttachmentInputs()).toEqual([
      {
        filename: "shot.jpg",
        storageKey: "attachments/test/key",
        contentType: "image/jpeg",
      },
    ]);
  });

  it("accepts a raw file over the size limit when preparation brings it under (the #369 paste contract)", async () => {
    const { uploadAttachment } = mockStigmer();
    const onValidationError = vi.fn();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() =>
      useAttachments({ onValidationError }),
    );

    // 10 MB + 1 raw screenshot — would be rejected by up-front validation.
    act(() => {
      result.current.addFiles(
        [makeFile("huge-screenshot.png", MAX_ATTACHMENT_BYTES + 1)],
        { prepareImages: true },
      );
    });
    expect(result.current.entries[0].phase).toBe("preparing");

    act(() => {
      gap.resolve(makeFile("huge-screenshot.png", 512 * 1024));
    });

    await waitFor(() => {
      expect(result.current.entries[0].phase).toBe("ready");
    });
    expect(onValidationError).not.toHaveBeenCalled();
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("removes the entry and reports via onValidationError when still oversized after preparation", async () => {
    const { uploadAttachment } = mockStigmer();
    const onValidationError = vi.fn();
    const oversized = makeFile("giant.zip", MAX_ATTACHMENT_BYTES + 1, "application/zip");
    // Non-image passthrough: preparation returns the original untouched.
    prepareMock.mockResolvedValue(oversized);

    const { result } = renderHook(() =>
      useAttachments({ onValidationError }),
    );

    act(() => {
      result.current.addFiles([oversized], { prepareImages: true });
    });
    expect(result.current.entries).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(0);
    });
    expect(onValidationError).toHaveBeenCalledWith(
      expect.stringContaining("giant.zip"),
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("discards the preparation result when the entry is removed mid-preparation", async () => {
    const { uploadAttachment } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useAttachments());

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], {
        prepareImages: true,
      });
    });
    const id = result.current.entries[0].id;

    act(() => {
      result.current.removeEntry(id);
    });
    expect(result.current.entries).toHaveLength(0);

    // Late completion must not resurrect the entry or start an upload.
    await act(async () => {
      gap.resolve(makeFile("shot.jpg", 512, "image/jpeg"));
      await gap.promise;
    });
    expect(result.current.entries).toHaveLength(0);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("discards the preparation result on clear()", async () => {
    const { uploadAttachment } = mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useAttachments());

    act(() => {
      result.current.addFiles([makeFile("shot.png", 1024)], {
        prepareImages: true,
      });
    });

    act(() => {
      result.current.clear();
    });

    await act(async () => {
      gap.resolve(makeFile("shot.jpg", 512, "image/jpeg"));
      await gap.promise;
    });
    expect(result.current.entries).toHaveLength(0);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("uniquifies the prepared name against other entries' settled names", async () => {
    mockStigmer();
    const gap = deferred<File>();
    prepareMock.mockReturnValue(gap.promise);

    const { result } = renderHook(() => useAttachments());

    // A settled entry already owns "pasted-image.png".
    act(() => {
      result.current.addFiles([makeFile("pasted-image.png", 256)]);
    });
    // The prepared file lands on the same name.
    act(() => {
      result.current.addFiles([makeFile("other.png", 256)], {
        prepareImages: true,
      });
    });
    act(() => {
      gap.resolve(makeFile("pasted-image.png", 128));
    });

    await waitFor(() => {
      expect(result.current.entries[1].phase).toBe("ready");
    });
    expect(result.current.entries[1].file.name).toBe("pasted-image-2.png");
  });
});

// ---------------------------------------------------------------------------
// The unflagged path — byte-identical to the pre-#369 behavior
// ---------------------------------------------------------------------------

describe("useAttachments — unflagged addFiles", () => {
  it("never enters the preparing phase and never calls prepareImageForVision", async () => {
    mockStigmer();

    const { result } = renderHook(() => useAttachments());

    act(() => {
      result.current.addFiles([makeFile("picked.png", 1024)]);
    });

    expect(result.current.entries[0].phase).toBe("uploading");
    expect(result.current.isPreparing).toBe(false);
    expect(prepareMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(result.current.entries[0].phase).toBe("ready");
    });
  });

  it("still validates size up front and rejects without creating an entry", () => {
    const { uploadAttachment } = mockStigmer();
    const onValidationError = vi.fn();

    const { result } = renderHook(() =>
      useAttachments({ onValidationError }),
    );

    act(() => {
      result.current.addFiles([
        makeFile("too-big.png", MAX_ATTACHMENT_BYTES + 1),
      ]);
    });

    expect(result.current.entries).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
});
