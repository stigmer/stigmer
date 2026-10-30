// The composer's three ways in for a user's own files, apart from paste:
// choosing them through the attach button's hidden file input, dragging them
// onto the composer and dropping them, and the `initialFiles` a host hands
// in at mount. Each adds one chip per file, named after the file. With
// `enableFiles={false}` a drag of plain files is not accepted (dragover is
// not prevented, so the browser shows no drop affordance) and a drop adds
// nothing; `initialFiles` are added once, never again on a re-render.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  createEvent,
  act,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalStigmerMock(): Stigmer {
  return {
    file: {
      uploadFile: vi.fn().mockResolvedValue({ metadata: { id: "file_1" }, status: { sessionId: "" } }),
      delete: vi.fn().mockResolvedValue({}),
    },
    vault: noMyVaultClient(),
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

type ComposerProps = ComponentProps<typeof SessionComposer>;

function composerElement(props?: Partial<ComposerProps>) {
  return <SessionComposer onSubmit={vi.fn()} org="acme" {...props} />;
}

function renderComposer(props?: Partial<ComposerProps>) {
  const client = createMinimalStigmerMock();
  const result = render(composerElement(props), { wrapper: createWrapper(client) });
  return { ...result, client };
}

function textFile(name: string, body = "hello"): File {
  return new File([body], name, { type: "text/plain" });
}

/** The card that owns the drag-and-drop handlers. */
function dropZone(container: HTMLElement): Element {
  const zone = container.querySelector("[class*='rounded-xl']");
  if (zone === null) throw new Error("composer drop zone not rendered");
  return zone;
}

/** A drag of plain files from the desktop: no file-reference payload. */
function fileDrag(files: File[]) {
  return {
    dataTransfer: {
      types: ["Files"],
      getData: () => "",
      files: files as unknown as FileList,
    },
  };
}

function chipLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="listitem"]')).map(
    (c) => c.getAttribute("aria-label") ?? "",
  );
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — choosing files", () => {
  it("adds a chip for each file chosen through the attach input", async () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, {
        target: { files: [textFile("report.txt"), textFile("notes.txt")] },
      });
    });

    expect(screen.getByText("report.txt")).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(chipLabels(container)).toHaveLength(2);
  });
});

describe("SessionComposer — dragging and dropping files", () => {
  it("accepts a drag of files and shows the drop prompt", async () => {
    const { container } = renderComposer();
    const zone = dropZone(container);

    const event = createEvent.dragOver(zone, fileDrag([textFile("report.txt")]));
    await act(async () => {
      fireEvent(zone, event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("Drop files to attach")).toBeTruthy();
  });

  it("adds a chip for each dropped file", async () => {
    const { container } = renderComposer();
    const zone = dropZone(container);

    await act(async () => {
      fireEvent.dragOver(zone, fileDrag([textFile("report.txt")]));
    });
    await act(async () => {
      fireEvent.drop(zone, fileDrag([textFile("report.txt"), textFile("data.csv")]));
    });

    expect(screen.getByText("report.txt")).toBeTruthy();
    expect(screen.getByText("data.csv")).toBeTruthy();
    expect(chipLabels(container)).toHaveLength(2);
    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  it("refuses a drag of files and adds nothing on drop when files are disabled", async () => {
    const { container } = renderComposer({ enableFiles: false });
    const zone = dropZone(container);

    const over = createEvent.dragOver(zone, fileDrag([textFile("report.txt")]));
    await act(async () => {
      fireEvent(zone, over);
    });
    expect(over.defaultPrevented).toBe(false);
    expect(screen.queryByText("Drop files to attach")).toBeNull();

    await act(async () => {
      fireEvent.drop(zone, fileDrag([textFile("report.txt")]));
    });
    expect(screen.queryByText("report.txt")).toBeNull();
    expect(chipLabels(container)).toHaveLength(0);
  });
});

describe("SessionComposer — initialFiles", () => {
  it("adds the files given at mount as chips, once", async () => {
    const initialFiles = [textFile("brief.txt"), textFile("spec.txt")];
    const client = createMinimalStigmerMock();
    const { container, rerender } = render(composerElement({ initialFiles }), {
      wrapper: createWrapper(client),
    });
    await act(async () => {});

    expect(screen.getByText("brief.txt")).toBeTruthy();
    expect(screen.getByText("spec.txt")).toBeTruthy();
    expect(chipLabels(container)).toHaveLength(2);

    await act(async () => {
      rerender(composerElement({ initialFiles: [...initialFiles] }));
    });
    expect(chipLabels(container)).toHaveLength(2);
  });
});
