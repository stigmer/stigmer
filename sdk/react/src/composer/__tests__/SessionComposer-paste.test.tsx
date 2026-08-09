import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  createEvent,
  act,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";
import { MAX_ATTACHMENT_BYTES } from "../../attachment/attachment-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalStigmerMock(): Stigmer {
  return {
    agentExecution: {
      uploadAttachment: vi
        .fn()
        .mockResolvedValue({ storageKey: "attachments/test-ulid/file" }),
    },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
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

function renderComposer(
  props?: Partial<React.ComponentProps<typeof SessionComposer>>,
) {
  const client = createMinimalStigmerMock();
  const onSubmit = vi.fn();
  const onAttachmentValidationError = vi.fn();

  const result = render(
    <SessionComposer
      onSubmit={onSubmit}
      onAttachmentValidationError={onAttachmentValidationError}
      {...props}
    />,
    { wrapper: createWrapper(client) },
  );

  return { ...result, onSubmit, onAttachmentValidationError, client };
}

function pngFile(
  name: string,
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
): File {
  return new File([bytes], name, { type: "image/png" });
}

/**
 * dom-testing-library special-cases `clipboardData` in event init, so the
 * handler receives it exactly as a real paste would deliver it. Files are
 * a plain array cast to FileList — the code only reads it array-like.
 */
function pasteInit(files: File[], text = "") {
  return {
    clipboardData: {
      files: files as unknown as FileList,
      getData: (type: string) => (type === "text/plain" ? text : ""),
      types: files.length > 0 ? ["Files"] : ["text/plain"],
    },
  };
}

/** Wait until no chip reports "uploading" in its accessible label. */
async function waitForUploadsSettled(container: HTMLElement) {
  await waitFor(() => {
    const uploading = container.querySelector('[aria-label*=", uploading"]');
    expect(uploading).toBeNull();
  });
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — clipboard paste", () => {
  it("attaches a pasted screenshot as a chip and uploads its bytes", async () => {
    const { container, client } = renderComposer();
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      fireEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    });

    // The generic clipboard name is replaced by a synthesized unique one.
    const chip = container.querySelector('[role="listitem"]');
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toMatch(/^pasted-image-\d{6}-\d+\.png/);

    await waitFor(() => {
      expect(
        (client as unknown as { agentExecution: { uploadAttachment: ReturnType<typeof vi.fn> } })
          .agentExecution.uploadAttachment,
      ).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses the default text insert when the clipboard carries files", async () => {
    renderComposer();
    const textarea = screen.getByRole("textbox");

    const event = createEvent.paste(textarea, pasteInit([pngFile("image.png")], "<img src=...>"));
    await act(async () => {
      fireEvent(textarea, event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a text-only paste completely untouched", async () => {
    const { container } = renderComposer();
    const textarea = screen.getByRole("textbox");

    const event = createEvent.paste(textarea, pasteInit([], "plain words"));
    await act(async () => {
      fireEvent(textarea, event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="listitem"]')).toBeNull();
  });

  it("gives two screenshots pasted in one turn distinct filenames", async () => {
    const { container } = renderComposer();
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      fireEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    });
    await act(async () => {
      fireEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    });

    const chips = Array.from(container.querySelectorAll('[role="listitem"]'));
    expect(chips).toHaveLength(2);
    const labels = chips.map((c) => c.getAttribute("aria-label"));
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("is inert when attachments are disabled (guest mode)", async () => {
    const { container } = renderComposer({ enableAttachments: false });
    const textarea = screen.getByRole("textbox");

    const event = createEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    await act(async () => {
      fireEvent(textarea, event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="listitem"]')).toBeNull();
  });

  it("is inert while the composer is disabled", async () => {
    const { container } = renderComposer({ disabled: true });
    const textarea = screen.getByRole("textbox");

    const event = createEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    await act(async () => {
      fireEvent(textarea, event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="listitem"]')).toBeNull();
  });

  it("routes an oversized paste through onAttachmentValidationError with no chip", async () => {
    const { container, onAttachmentValidationError } = renderComposer();
    const textarea = screen.getByRole("textbox");

    const huge = pngFile("image.png", new Uint8Array(MAX_ATTACHMENT_BYTES + 1));
    await act(async () => {
      fireEvent.paste(textarea, pasteInit([huge]));
    });

    expect(onAttachmentValidationError).toHaveBeenCalledTimes(1);
    expect(onAttachmentValidationError.mock.calls[0][0]).toContain("10 MB");
    expect(container.querySelector('[role="listitem"]')).toBeNull();
  });

  it("includes the pasted attachment in the submit context", async () => {
    const { container, onSubmit } = renderComposer();
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      fireEvent.paste(textarea, pasteInit([pngFile("image.png")]));
    });
    await waitForUploadsSettled(container);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "What is wrong in this screenshot?" } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.attachments).toHaveLength(1);
    expect(context.attachments[0].filename).toMatch(/^pasted-image-/);
    expect(context.attachments[0].storageKey).toBe("attachments/test-ulid/file");
    expect(context.attachments[0].contentType).toBe("image/png");
  });

  it("keeps the drop path working: same-named drops are uniquified, not clobbered", async () => {
    const { container } = renderComposer();
    const dropTarget = container.querySelector("[class*='rounded-xl']")!;

    const dropEvent = (files: File[]) => ({
      dataTransfer: {
        types: ["Files"],
        getData: () => "",
        files: files as unknown as FileList,
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await act(async () => {
      fireEvent.drop(
        dropTarget,
        dropEvent([
          new File(["a"], "notes.md", { type: "text/markdown" }),
          new File(["b"], "notes.md", { type: "text/markdown" }),
        ]),
      );
    });

    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("notes-2.md")).toBeTruthy();
  });
});
