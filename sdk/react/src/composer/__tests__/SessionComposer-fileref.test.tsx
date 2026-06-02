import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";
import { FILE_REF_MIME } from "../../internal/file-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalStigmerMock(): Stigmer {
  return {
    agentExecution: { uploadAttachment: vi.fn() },
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

  const result = render(
    <SessionComposer onSubmit={onSubmit} {...props} />,
    { wrapper: createWrapper(client) },
  );

  return { ...result, onSubmit, client };
}

function getDropTarget(container: HTMLElement): Element {
  return container.querySelector("[class*='rounded-xl']")!;
}

function createFileRefDropEvent(path: string) {
  return {
    dataTransfer: {
      types: [FILE_REF_MIME],
      getData: (type: string) =>
        type === FILE_REF_MIME ? JSON.stringify({ path }) : "",
      files: { length: 0 } as unknown as FileList,
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer \u2014 file reference integration", () => {
  it("accepts a file-ref drop and renders a chip", async () => {
    const { container } = renderComposer();
    const dropTarget = getDropTarget(container);

    await act(async () => {
      fireEvent.drop(dropTarget, createFileRefDropEvent("src/config.yaml"));
    });

    const chip = container.querySelector('[aria-label="Referenced file: src/config.yaml"]');
    expect(chip).toBeTruthy();
  });

  it("shows 'Reference workspace file' overlay text during file-ref drag over", () => {
    const { container } = renderComposer();
    const dropTarget = getDropTarget(container);

    const dragOverEvent = {
      dataTransfer: {
        types: [FILE_REF_MIME],
        files: { length: 0 } as unknown as FileList,
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    fireEvent.dragOver(dropTarget, dragOverEvent);

    expect(screen.getByText("Reference workspace file")).toBeTruthy();
  });

  it("includes workspaceFileRefs in submit context", async () => {
    const { container, onSubmit } = renderComposer();
    const dropTarget = getDropTarget(container);

    await act(async () => {
      fireEvent.drop(dropTarget, createFileRefDropEvent("src/config.yaml"));
    });

    const textarea = screen.getByRole("textbox");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Review this" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.workspaceFileRefs).toEqual(["src/config.yaml"]);
  });

  it("clears file refs after submit", async () => {
    const { container } = renderComposer();
    const dropTarget = getDropTarget(container);

    await act(async () => {
      fireEvent.drop(dropTarget, createFileRefDropEvent("a.ts"));
    });

    expect(
      container.querySelector('[aria-label="Referenced file: a.ts"]'),
    ).toBeTruthy();

    const textarea = screen.getByRole("textbox");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Do it" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(
      container.querySelector('[aria-label="Referenced file: a.ts"]'),
    ).toBeNull();
  });

  it("does not create file-ref chips when enableFileReferences is false", async () => {
    const { container } = renderComposer({ enableFileReferences: false });
    const dropTarget = getDropTarget(container);

    await act(async () => {
      fireEvent.drop(dropTarget, createFileRefDropEvent("src/config.yaml"));
    });

    expect(
      container.querySelector('[aria-label="Referenced file: src/config.yaml"]'),
    ).toBeNull();
  });

  it("removes a file-ref chip when its remove button is clicked", async () => {
    const { container } = renderComposer();
    const dropTarget = getDropTarget(container);

    await act(async () => {
      fireEvent.drop(dropTarget, createFileRefDropEvent("a.ts"));
    });

    const chip = container.querySelector('[aria-label="Referenced file: a.ts"]');
    expect(chip).toBeTruthy();

    const removeBtn = chip!.querySelector("button")!;
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(
      container.querySelector('[aria-label="Referenced file: a.ts"]'),
    ).toBeNull();
  });
});
