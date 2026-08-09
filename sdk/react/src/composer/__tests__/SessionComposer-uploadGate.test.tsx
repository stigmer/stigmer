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
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WAIT_NOTICE = "Waiting for attachments to finish uploading…";

/**
 * Stigmer mock whose uploadAttachment resolution is controlled by the test,
 * so a test can hold the composer in the "uploading" phase deliberately.
 */
function createDeferredUploadMock() {
  const pending: Array<(value: { storageKey: string }) => void> = [];
  const rejectors: Array<(err: Error) => void> = [];

  const uploadAttachment = vi.fn(
    () =>
      new Promise<{ storageKey: string }>((resolve, reject) => {
        pending.push(resolve);
        rejectors.push(reject);
      }),
  );

  const client = {
    agentExecution: { uploadAttachment },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;

  return {
    client,
    uploadAttachment,
    resolveAll: () => {
      for (const resolve of pending.splice(0)) {
        resolve({ storageKey: "attachments/test-ulid/file" });
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

function renderComposer(client: Stigmer) {
  const onSubmit = vi.fn();
  const result = render(<SessionComposer onSubmit={onSubmit} />, {
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

  it("clears the notice and sends WITH the attachment once uploads settle", async () => {
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
    expect(context?.attachments).toHaveLength(1);
    expect(context.attachments[0].storageKey).toBe("attachments/test-ulid/file");
  });

  it("does not show the notice when Enter is blocked for another reason (empty message)", async () => {
    const mock = createDeferredUploadMock();
    renderComposer(mock.client);
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteImage(textarea);
    });
    // Enter with an empty message: blocked by canSubmit, not by uploads —
    // claiming "waiting for attachments" here would be a lie.
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
    // The failed upload has no storage key — it must not ride the send.
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.attachments ?? []).toHaveLength(0);
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
    expect(onSubmit.mock.calls[0][2]?.attachments).toHaveLength(2);
  });
});
