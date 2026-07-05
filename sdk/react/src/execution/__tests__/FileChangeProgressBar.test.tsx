/**
 * FileChangeProgressBar — the live "N files changed so far" strip for a running
 * turn (DD-32). These tests cover its own responsibilities: emptiness, the
 * summary count + aggregate stat, the expandable per-file list with its cap
 * overflow, zero-count hiding, and that only the count is an aria-live region.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
  type FileChangeProgress,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { FileChangeProgressBar } from "../FileChangeProgressBar";

function entry(path: string, kind: FileChangeKind, added: number, removed: number) {
  return create(FileChangeProgressEntrySchema, {
    pathBefore: kind === FileChangeKind.ADD ? "" : path,
    pathAfter: kind === FileChangeKind.DELETE ? "" : path,
    kind,
    linesAdded: added,
    linesRemoved: removed,
  });
}

function progress(overrides: Partial<FileChangeProgress> = {}): FileChangeProgress {
  return create(FileChangeProgressSchema, {
    changeSetId: "exec:0",
    filesChanged: 2,
    linesAdded: 7,
    linesRemoved: 3,
    entries: [
      entry("src/a.ts", FileChangeKind.ADD, 5, 0),
      entry("src/b.ts", FileChangeKind.MODIFY, 2, 3),
    ],
    capturedAt: "2026-07-05T00:00:00Z",
    ...overrides,
  });
}

afterEach(() => cleanup());

describe("FileChangeProgressBar", () => {
  it("renders nothing when progress is undefined", () => {
    const { container } = render(<FileChangeProgressBar progress={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when zero files have changed (revert-to-clean)", () => {
    const { container } = render(
      <FileChangeProgressBar
        progress={progress({ filesChanged: 0, entries: [], linesAdded: 0, linesRemoved: 0 })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the summary count and aggregate +N −M", () => {
    render(<FileChangeProgressBar progress={progress()} />);
    expect(screen.getByText(/2 files changing/)).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
  });

  it("uses the singular noun for a single file", () => {
    render(
      <FileChangeProgressBar
        progress={progress({ filesChanged: 1, entries: [entry("only.ts", FileChangeKind.ADD, 1, 0)] })}
      />,
    );
    expect(screen.getByText(/1 file changing/)).toBeTruthy();
  });

  it("puts only the count in an aria-live region, not the per-file list", () => {
    render(<FileChangeProgressBar progress={progress()} />);
    const live = screen.getByText(/2 files changing/);
    expect(live.getAttribute("aria-live")).toBe("polite");
    // The expandable list is not part of any live region.
    fireEvent.click(screen.getByRole("button", { name: /2 files changing/ }));
    const link = screen.getByText("a.ts");
    expect(link.closest("[aria-live]")).toBeNull();
  });

  it("expands to a per-file list on click and collapses again", () => {
    render(<FileChangeProgressBar progress={progress()} />);
    expect(screen.queryByText("a.ts")).toBeNull();

    const toggle = screen.getByRole("button", { name: /2 files changing/ });
    fireEvent.click(toggle);
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(screen.queryByText("a.ts")).toBeNull();
  });

  it("shows an honest overflow line when the entry list is capped", () => {
    // 5 files changed but only 2 entries carried → "… and 3 more".
    render(<FileChangeProgressBar progress={progress({ filesChanged: 5 })} />);
    fireEvent.click(screen.getByRole("button", { name: /5 files changing/ }));
    expect(screen.getByText(/and 3 more/)).toBeTruthy();
  });

  it("hides the per-file stat when both counts are zero (binary/secret)", () => {
    render(
      <FileChangeProgressBar
        progress={progress({
          filesChanged: 1,
          linesAdded: 0,
          linesRemoved: 0,
          entries: [entry(".env", FileChangeKind.MODIFY, 0, 0)],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 file changing/ }));
    // The secret path is present…
    expect(screen.getByText(".env")).toBeTruthy();
    // …but no +0 −0 stat is rendered anywhere.
    expect(screen.queryByText("+0")).toBeNull();
  });
});
