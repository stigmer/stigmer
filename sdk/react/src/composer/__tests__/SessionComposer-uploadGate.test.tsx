/**
 * SessionComposer's files: the send gate holds a message while a file is
 * still uploading (a send racing it would drop the file), and the chat
 * box's Files reach the submit context. Pins where each File is uploaded
 * (the conversation's, or the person's own before the first message),
 * that sending deletes nothing until the context's releaseFiles runs, and
 * that a chip removed before sending deletes its File.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WAIT_NOTICE = "Waiting for files to finish uploading…";

interface UploadedFile {
  readonly metadata: { readonly id: string };
  readonly status: { readonly sessionId: string };
}

/**
 * Stigmer mock whose File uploads resolve when the test says, so a test can
 * hold the composer in the "uploading" phase deliberately. Each upload
 * answers the next id (file_1, file_2, ...) in the session it was sent to.
 */
function createDeferredUploadMock() {
  const pending: Array<() => void> = [];
  const rejectors: Array<(err: Error) => void> = [];
  let uploads = 0;

  const uploadFile = vi.fn(
    (options: { sessionId?: string }) =>
      new Promise<UploadedFile>((resolve, reject) => {
        const id = `file_${++uploads}`;
        pending.push(() => resolve({ metadata: { id }, status: { sessionId: options.sessionId ?? "" } }));
        rejectors.push(reject);
      }),
  );
  const deleteFile = vi.fn().mockResolvedValue({});

  const client = {
    file: { uploadFile, delete: deleteFile },
    vault: noMyVaultClient(),
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;

  return {
    client,
    uploadFile,
    deleteFile,
    resolveAll: () => {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
      rejectors.length = 0;
    },
    rejectAll: () => {
      for (const reject of rejectors.splice(0)) {
        reject(new Error("upload failed for test"));
      }
      pending.length = 0;
    },
  };
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function renderComposer(client: Stigmer, sessionId?: string) {
  const onSubmit = vi.fn();
  const result = render(<SessionComposer onSubmit={onSubmit} org="acme" sessionId={sessionId} />, {
    wrapper: createWrapper(client),
  });
  return { ...result, onSubmit };
}

function pasteImage(textarea: Element) {
  fireEvent.paste(textarea, {
    clipboardData: {
      files: [
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", {
          type: "image/png",
        }),
      ] as unknown as FileList,
      getData: () => "",
      types: ["Files"],
    },
  });
}

function typeAndEnter(textarea: Element, message: string) {
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — mid-upload send gate", () => {
  it("blocks Enter while an upload is in flight and shows the wait notice", async () => {
    const mock = createDeferredUploadMock();
    const { onSubmit } = renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      typeAndEnter(textarea, "What is wrong in this screenshot?");
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(WAIT_NOTICE)).toBeTruthy();
    expect(screen.getByText(WAIT_NOTICE).closest('[role="status"]')).toBeTruthy();
  });

  it("clears the notice and sends WITH the file once uploads settle", async () => {
    const mock = createDeferredUploadMock();
    const { onSubmit } = renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      typeAndEnter(textarea, "What is wrong here?");
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      mock.resolveAll();
    });

    await waitFor(() => {
      expect(screen.queryByText(WAIT_NOTICE)).toBeNull();
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [message, , context] = onSubmit.mock.calls[0];
    expect(message).toBe("What is wrong here?");
    expect(context?.fileIds).toEqual(["file_1"]);
    // The optimistic bubble's chip; a paste is named pasted-image-*.
    expect(context?.files).toHaveLength(1);
    expect(context?.files[0]).toMatchObject({ fileId: "file_1", kind: "image" });
  });

  it("does not show the notice when Enter is blocked for another reason (empty message)", async () => {
    const mock = createDeferredUploadMock();
    renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    // Enter with an empty message: blocked by canSubmit, not by uploads —
    // claiming "waiting for files" here would be a lie.
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(screen.queryByText(WAIT_NOTICE)).toBeNull();
  });

  it("does not wedge the composer when an upload errors — send proceeds without the failed file", async () => {
    const mock = createDeferredUploadMock();
    const { onSubmit } = renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      mock.rejectAll();
    });

    // The errored chip stays visible with retry/remove, but must not gate.
    await waitFor(() => {
      const chip = document.querySelector('[aria-label*="upload failed"]');
      expect(chip).toBeTruthy();
    });

    await act(async () => {
      typeAndEnter(textarea, "Send it anyway");
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The failed upload has no File: it must not ride the send.
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.fileIds ?? []).toHaveLength(0);
  });

  it("gates a fast follow-up paste too: Enter between two uploads still waits for the second", async () => {
    const mock = createDeferredUploadMock();
    const { onSubmit } = renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      mock.resolveAll();
    });
    await act(async () => {
      pasteImage(textarea);
    });

    await act(async () => {
      typeAndEnter(textarea, "Compare these two");
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      mock.resolveAll();
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][2]?.fileIds).toEqual(["file_1", "file_2"]);
  });
});

describe("SessionComposer — the chat box's Files", () => {
  async function sendWithOneFile(mock: ReturnType<typeof createDeferredUploadMock>, sessionId?: string) {
    const { onSubmit } = renderComposer(mock.client, sessionId);
    const textarea = screen.getByRole("textbox");
    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      mock.resolveAll();
    });
    await waitFor(() => expect(screen.queryByText(WAIT_NOTICE)).toBeNull());
    await act(async () => {
      typeAndEnter(textarea, "Look at this");
    });
    return onSubmit.mock.calls[0][2] as {
      fileIds?: string[];
      releaseFiles?: () => Promise<void>;
    };
  }

  it("before the first message, uploads the person's own File and deletes it only when released", async () => {
    const mock = createDeferredUploadMock();
    const context = await sendWithOneFile(mock);

    expect(mock.uploadFile.mock.calls[0][0]).toMatchObject({ org: "acme", sessionId: undefined });
    expect(context.fileIds).toEqual(["file_1"]);
    // Sending empties the chat box but deletes nothing: the run does not exist yet.
    expect(mock.deleteFile).not.toHaveBeenCalled();

    await act(async () => {
      await context.releaseFiles?.();
    });
    expect(mock.deleteFile).toHaveBeenCalledWith("file_1");
  });

  it("in a conversation, uploads into it and keeps the File on release", async () => {
    const mock = createDeferredUploadMock();
    const context = await sendWithOneFile(mock, "ses_1");

    expect(mock.uploadFile.mock.calls[0][0]).toMatchObject({ org: "acme", sessionId: "ses_1" });
    await act(async () => {
      await context.releaseFiles?.();
    });
    expect(mock.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes the File of a chip removed before sending", async () => {
    const mock = createDeferredUploadMock();
    renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");
    await act(async () => {
      pasteImage(textarea);
    });
    await act(async () => {
      mock.resolveAll();
    });

    const remove = await screen.findByRole("button", { name: /remove/i });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(mock.deleteFile).toHaveBeenCalledWith("file_1");
  });
});
