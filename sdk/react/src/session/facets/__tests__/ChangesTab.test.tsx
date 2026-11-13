/**
 * ChangesTab — the session panel's Pull requests view: one card per git
 * write-back, and, before any push, one inline line that says truthfully
 * where a turn's work goes (pushed when the turn ends, an Undo pushed after
 * it), never that a push waits for approval.
 */
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

  // Local file changes render in the transcript (edit rows + a turn's
  // Changed group), never here — the tab is exclusively the write-back (PR)
  // surface.
  it("renders the PR-oriented inline line when no write-back exists", () => {
    render(<ChangesTab runs={[]} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe(
      "No pull requests yet Pull requests appear here when the agent pushes its work to your repository.",
    );
  });

  // Pre-push states for a session expected to write back (cloud + git): a
  // live turn says its work is pushed when it ends; a settled session says
  // each turn's work is pushed at its end, and an Undo after it.
  it("says a working turn's work is pushed when it ends", () => {
    render(<ChangesTab runs={[]} expectsWriteBack isSettled={false} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe(
      "Nothing pushed yet This turn's work is pushed to the session's branch when it ends.",
    );
  });

  it("says each turn's work is pushed at its end, and an Undo after it, once settled with nothing pushed", () => {
    render(<ChangesTab runs={[]} expectsWriteBack isSettled />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe(
      "Nothing pushed yet Each turn's work is pushed to the session's branch when the turn ends, and an Undo is pushed after it.",
    );
  });

  it("never says a push waits for approval, in any empty state", () => {
    for (const props of [{}, { expectsWriteBack: true, isSettled: false }, { expectsWriteBack: true, isSettled: true }]) {
      const { container } = render(<ChangesTab runs={[]} {...props} />);
      expect(container.textContent).not.toMatch(/approv|review/i);
      cleanup();
    }
  });

  it("write-backs take precedence over the pre-push states", () => {
    writeBacksReturn.writeBacks = [{ writeBack: { workspaceEntryName: "w1" } }];
    writeBacksReturn.hasWriteBacks = true;

    render(<ChangesTab runs={[]} expectsWriteBack />);
    expect(screen.getByTestId("write-back-card")).toBeTruthy();
    expect(screen.queryByText(/nothing pushed/i)).toBeNull();
  });
});
