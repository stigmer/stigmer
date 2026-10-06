import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const writeBacksReturn = { writeBacks: [] as Array<{ writeBack: { workspaceEntryName: string } }>, hasWriteBacks: false };

vi.mock("../../useSessionWriteBacks", () => ({
  useSessionWriteBacks: () => writeBacksReturn,
}));
vi.mock("../../../run/WriteBackCard", () => ({
  WriteBackCard: () => <div data-testid="write-back-card" />,
}));

const { ChangesTab } = await import("../ChangesTab");

beforeEach(() => {
  writeBacksReturn.writeBacks = [];
  writeBacksReturn.hasWriteBacks = false;
});

afterEach(() => cleanup());

describe("ChangesTab", () => {
  it("renders write-back (PR) cards", () => {
    writeBacksReturn.writeBacks = [{ writeBack: { workspaceEntryName: "w1" } }];
    writeBacksReturn.hasWriteBacks = true;

    render(<ChangesTab runs={[]} />);
    expect(screen.getByTestId("write-back-card")).toBeTruthy();
  });

  // Local file changes render in the transcript (edit rows + decision bar),
  // never here — the tab is exclusively the write-back (PR) surface.
  it("renders the PR-oriented empty state when no write-back exists", () => {
    render(<ChangesTab runs={[]} />);
    expect(screen.getByText(/no changes yet/i)).toBeTruthy();
    expect(screen.getByText(/pull requests/i)).toBeTruthy();
  });

  // Pre-push states for a session expected to write back (cloud + git):
  // live turns promise where approved work will land; a settled run
  // reports honestly that nothing was pushed.
  it("renders the in-review promise while a write-back is expected and the session is live", () => {
    render(<ChangesTab runs={[]} expectsWriteBack isSettled={false} />);
    expect(screen.getByText(/stay in the session workspace/i)).toBeTruthy();
    expect(screen.getByText(/pushed to a branch and pull request here/i)).toBeTruthy();
  });

  it("renders the nothing-pushed state when expected but the execution settled without a push", () => {
    render(<ChangesTab runs={[]} expectsWriteBack isSettled />);
    expect(screen.getByText(/no changes have been pushed yet/i)).toBeTruthy();
  });

  it("write-backs take precedence over the pre-push states", () => {
    writeBacksReturn.writeBacks = [{ writeBack: { workspaceEntryName: "w1" } }];
    writeBacksReturn.hasWriteBacks = true;

    render(<ChangesTab runs={[]} expectsWriteBack />);
    expect(screen.getByTestId("write-back-card")).toBeTruthy();
    expect(screen.queryByText(/no changes/i)).toBeNull();
  });
});
