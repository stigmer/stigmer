import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import type { ModelRegistryState } from "../../models/ModelRegistryContext";
import { parseRegistryDocument } from "../../models/registry";
import type { VisionLimits } from "../../models/registry";
import { SessionComposer } from "../SessionComposer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The production budget the registry advertises (3 MiB / 4 MiB / 10). */
const LIMITS: VisionLimits = {
  maxImageBytes: 3 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxImages: 10,
};

/**
 * Registry fixture routed through the REAL document parser so this test
 * also breaks if the parse contract drifts. kimi-k3 mirrors the live
 * registry's explicitly-blind cursor model.
 */
const REGISTRY_DOCUMENT = parseRegistryDocument({
  limits: { vision: { ...LIMITS } },
  models: [
    {
      id: "claude-sonnet-4.6",
      displayName: "Claude Sonnet 4.6",
      provider: "anthropic",
      harness: "native",
      costTier: "standard",
      featured: true,
      capabilities: { toolUse: true, vision: true, streaming: true, thinking: true, adaptiveThinking: false },
      pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
    },
    {
      id: "kimi-k3",
      displayName: "Kimi K3",
      provider: "moonshot",
      harness: "cursor",
      costTier: "economy",
      featured: false,
      capabilities: { toolUse: true, vision: false, streaming: true, thinking: false, adaptiveThinking: false },
      pricing: { inputPricePerMillion: 1, outputPricePerMillion: 3, cacheWritePricePerMillion: 1, cacheReadPricePerMillion: 0.1 },
    },
  ],
});

function createUploadMockClient(): Stigmer {
  return {
    agentExecution: {
      uploadAttachment: vi.fn().mockResolvedValue({ storageKey: "attachments/test/file" }),
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

function createWrapper(registry?: Partial<ModelRegistryState>) {
  const client = createUploadMockClient();
  const state: ModelRegistryState = {
    models: REGISTRY_DOCUMENT.models,
    visionLimits: REGISTRY_DOCUMENT.visionLimits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...registry,
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider value={state}>
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function pngFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: "image/png" });
}

function pasteFiles(textarea: Element, files: File[]) {
  fireEvent.paste(textarea, {
    clipboardData: {
      files: files as unknown as FileList,
      getData: () => "",
      types: ["Files"],
    },
  });
}

const OVERSIZED = Math.round(3.6 * 1024 * 1024);
const SMALL = 64 * 1024;

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — vision preflight notice (#365, #386)", () => {
  it("warns at paste time when an image exceeds the advertised per-image cap", async () => {
    render(<SessionComposer onSubmit={vi.fn()} />, { wrapper: createWrapper() });
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("screenshot.png", OVERSIZED)]);
    });

    const notice = screen.getByText(
      /screenshot\.png \(3\.6 MB\) exceeds the 3\.0 MB inline-image limit/,
    );
    expect(notice).toBeTruthy();
    expect(notice.closest('[role="status"]')).toBeTruthy();
  });

  it("stays silent for images within the budget", async () => {
    render(<SessionComposer onSubmit={vi.fn()} />, { wrapper: createWrapper() });
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("small.png", SMALL)]);
    });

    expect(screen.queryByText(/inline-image/)).toBeNull();
  });

  it("stays silent when the server advertises no limits (older server, tri-state)", async () => {
    render(<SessionComposer onSubmit={vi.fn()} />, {
      wrapper: createWrapper({ visionLimits: undefined }),
    });
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("huge.png", OVERSIZED)]);
    });

    expect(screen.queryByText(/inline-image/)).toBeNull();
  });

  it("clears the warning when the offending attachment is removed", async () => {
    render(<SessionComposer onSubmit={vi.fn()} />, { wrapper: createWrapper() });
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("screenshot.png", OVERSIZED)]);
    });
    expect(screen.getByText(/exceeds the 3\.0 MB inline-image limit/)).toBeTruthy();

    const removeButton = screen.getByRole("button", { name: /remove screenshot\.png/i });
    await act(async () => {
      fireEvent.click(removeButton);
    });

    expect(screen.queryByText(/inline-image/)).toBeNull();
  });

  it("leads with the model when the selected model is explicitly blind", async () => {
    render(
      <SessionComposer onSubmit={vi.fn()} defaultModelId="cursor/kimi-k3" />,
      { wrapper: createWrapper() },
    );
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("tiny.png", SMALL)]);
    });

    expect(
      screen.getByText(
        "Kimi K3 can't view images — attached images will reach the agent as files only.",
      ),
    ).toBeTruthy();
  });

  it("never warns about non-image attachments on a blind model", async () => {
    render(
      <SessionComposer onSubmit={vi.fn()} defaultModelId="cursor/kimi-k3" />,
      { wrapper: createWrapper() },
    );
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [
        new File([new Uint8Array(SMALL)], "notes.pdf", { type: "application/pdf" }),
      ]);
    });

    expect(screen.queryByText(/can't view images/)).toBeNull();
  });

  it("does not gate the send — the warned message still submits with the attachment", async () => {
    const onSubmit = vi.fn();
    render(<SessionComposer onSubmit={onSubmit} />, { wrapper: createWrapper() });
    const textarea = screen.getByRole("textbox");

    await act(async () => {
      pasteFiles(textarea, [pngFile("screenshot.png", OVERSIZED)]);
    });
    expect(screen.getByText(/exceeds the 3\.0 MB inline-image limit/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "look at this anyway" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][2]?.attachments).toHaveLength(1);
  });
});
