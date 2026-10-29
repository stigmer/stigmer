/**
 * The output-File list row: icon, filename and size; the output path's folder
 * as a subtitle only on a name collision; Download a sibling of the open
 * target and minted per click from the File's id; open on click, activate on
 * double-click.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { StigmerContext } from "../../context";
import { FileRow } from "../FileRow";

function outputFile(filename: string, outputPath = filename) {
  return create(FileSchema, {
    metadata: { id: `file_${filename.replace(/\W/g, "_")}` },
    spec: { filename },
    status: { sizeBytes: 2048n, runId: "run_1", outputPath },
  });
}

const getDownloadUrl = vi.fn().mockResolvedValue({ url: "" });

function createStigmerMock(): Stigmer {
  return {
    file: { getDownloadUrl },
  } as unknown as Stigmer;
}

function renderRow(props: Partial<Parameters<typeof FileRow>[0]> = {}) {
  const merged = {
    file: outputFile("notes.md"),
    onOpen: vi.fn(),
    ...props,
  } as Parameters<typeof FileRow>[0];
  return render(
    <StigmerContext.Provider value={createStigmerMock()}>
      <ul>
        <FileRow {...merged} />
      </ul>
    </StigmerContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  getDownloadUrl.mockClear();
});

describe("FileRow — presentation", () => {
  it("renders a file-type icon, the name, and the formatted size", () => {
    renderRow({ file: outputFile("notes.md") });
    const open = screen.getByText("notes.md").closest("button")!;
    expect(open.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("shows the parent-directory subtitle only on a name collision", () => {
    const output = outputFile("agent.yaml", "configs/agent.yaml");
    const { rerender } = renderRow({ file: output, hasNameCollision: true });
    expect(screen.getByText("configs/")).toBeTruthy();

    rerender(
      <StigmerContext.Provider value={createStigmerMock()}>
        <ul>
          <FileRow file={output} onOpen={vi.fn()} />
        </ul>
      </StigmerContext.Provider>,
    );
    expect(screen.queryByText("configs/")).toBeNull();
  });
});

describe("FileRow — nested-interactive avoidance", () => {
  it("renders the Download control as a SIBLING of the open button, never nested", () => {
    renderRow({ file: outputFile("notes.md") });
    const open = screen.getByText("notes.md").closest("button")!;
    const download = screen.getByLabelText("Download notes.md");
    expect(download.tagName).toBe("BUTTON");
    // A <button> inside a <button> is a WCAG 4.1.2 nested-interactive violation.
    expect(open.contains(download)).toBe(false);
  });
});

describe("FileRow — open / activate interaction (file-tree parity)", () => {
  it("fires onOpen on a single click of the open target", () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    fireEvent.click(screen.getByText("notes.md"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("fires onActivate on a double-click when provided", () => {
    const onActivate = vi.fn();
    renderRow({ onActivate });
    fireEvent.doubleClick(screen.getByText("notes.md"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("binds no double-click handler when onActivate is omitted (harmless)", () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    // With no onActivate, a dblclick fires nothing (onOpen only responds to click).
    fireEvent.doubleClick(screen.getByText("notes.md"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("FileRow — download", () => {
  it("mints a download link for the File's id on Download click", () => {
    renderRow({ file: outputFile("notes.md") });
    fireEvent.click(screen.getByLabelText("Download notes.md"));
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(getDownloadUrl.mock.calls[0][0]).toBe("file_notes_md");
  });

  it("renders the Download control with no native title", () => {
    renderRow({ file: outputFile("notes.md") });
    expect(screen.getByLabelText("Download notes.md")).toBeTruthy();
    expect(document.querySelector("[title]")).toBeNull();
  });
});
