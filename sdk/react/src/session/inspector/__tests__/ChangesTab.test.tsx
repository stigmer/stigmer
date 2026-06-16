import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const writeBacksReturn = { writeBacks: [] as Array<{ writeBack: { workspaceEntryName: string } }>, hasWriteBacks: false };
const fileChangesReturn = { fileChanges: [] as unknown[], hasFileChanges: false, fileChangeCount: 0 };

vi.mock("../../useSessionWriteBacks", () => ({
  useSessionWriteBacks: () => writeBacksReturn,
}));
vi.mock("../../useSessionFileChanges", () => ({
  useSessionFileChanges: () => fileChangesReturn,
}));
vi.mock("../../../execution/WriteBackCard", () => ({
  WriteBackCard: () => <div data-testid="write-back-card" />,
}));
vi.mock("../../../execution/FileChangesView", () => ({
  FileChangesView: () => <div data-testid="file-changes-view" />,
}));

const { ChangesTab } = await import("../ChangesTab");

beforeEach(() => {
  writeBacksReturn.writeBacks = [];
  writeBacksReturn.hasWriteBacks = false;
  fileChangesReturn.fileChanges = [];
  fileChangesReturn.hasFileChanges = false;
  fileChangesReturn.fileChangeCount = 0;
});

afterEach(() => cleanup());

describe("ChangesTab", () => {
  it("renders write-back (PR) cards in git mode", () => {
    writeBacksReturn.writeBacks = [{ writeBack: { workspaceEntryName: "w1" } }];
    writeBacksReturn.hasWriteBacks = true;
    // File changes may also be present mid-execution; write-backs win the tab.
    fileChangesReturn.hasFileChanges = true;

    render(<ChangesTab executions={[]} />);
    expect(screen.getByTestId("write-back-card")).toBeTruthy();
    expect(screen.queryByTestId("file-changes-view")).toBeNull();
  });

  it("renders the file-changes view in local mode", () => {
    fileChangesReturn.hasFileChanges = true;

    render(<ChangesTab executions={[]} />);
    expect(screen.getByTestId("file-changes-view")).toBeTruthy();
    expect(screen.queryByTestId("write-back-card")).toBeNull();
  });

  it("renders an empty state covering both PRs and file edits", () => {
    render(<ChangesTab executions={[]} />);
    expect(screen.getByText(/no changes yet/i)).toBeTruthy();
    expect(screen.getByText(/pull requests/i)).toBeTruthy();
  });
});
