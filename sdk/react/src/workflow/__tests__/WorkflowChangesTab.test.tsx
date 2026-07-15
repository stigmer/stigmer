import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  type FileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowChangesTab } from "../facets/WorkflowChangesTab";

function change(path: string, changeType = FileChangeType.MODIFY): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: "@@ -1 +1 @@\n-a\n+b",
    linesAdded: 1,
    linesRemoved: 1,
  });
}

afterEach(cleanup);

describe("WorkflowChangesTab", () => {
  it("renders one row per changed file with its path", () => {
    render(
      <WorkflowChangesTab
        fileChanges={[change("src/a.ts"), change("src/b.ts")]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("src/b.ts")).toBeTruthy();
  });

  it("clicking a row opens THAT file's change", () => {
    const onOpen = vi.fn();
    const changes = [change("src/a.ts"), change("src/b.ts")];
    render(<WorkflowChangesTab fileChanges={changes} onOpen={onOpen} />);

    fireEvent.click(screen.getByText("src/b.ts"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(changes[1]);
  });

  it("marks the active tab's row as current", () => {
    render(
      <WorkflowChangesTab
        fileChanges={[change("src/a.ts"), change("src/b.ts")]}
        activePath="src/b.ts"
        onOpen={vi.fn()}
      />,
    );
    const active = screen.getByText("src/b.ts").closest("button");
    expect(active?.getAttribute("aria-current")).toBe("true");
    const inactive = screen.getByText("src/a.ts").closest("button");
    expect(inactive?.getAttribute("aria-current")).toBeNull();
  });

  it("shows the loading state during the first fetch round", () => {
    render(<WorkflowChangesTab fileChanges={[]} isLoading onOpen={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading file changes…",
    );
  });

  it("shows the empty state when the rollup has no changes", () => {
    render(<WorkflowChangesTab fileChanges={[]} onOpen={vi.fn()} />);
    expect(screen.getByText(/No file changes yet/)).toBeTruthy();
  });

  it("shows a background-refresh status line while stale data is displayed", () => {
    render(
      <WorkflowChangesTab
        fileChanges={[change("src/a.ts")]}
        isRefetching
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Updating…");
    // The stale list stays visible — refresh never blanks the facet.
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("names a partial-fetch failure while still rendering the loaded changes", () => {
    render(
      <WorkflowChangesTab
        fileChanges={[change("src/a.ts")]}
        error={new Error("child aex_x unreachable")}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Some task changes could not be loaded: child aex_x unreachable",
    );
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("shows the error alongside the empty state when nothing loaded at all", () => {
    render(
      <WorkflowChangesTab
        fileChanges={[]}
        error={new Error("boom")}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/No file changes yet/)).toBeTruthy();
  });
});
