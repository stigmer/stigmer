import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const writeBacksReturn = { writeBacks: [] as Array<{ writeBack: { workspaceEntryName: string } }>, hasWriteBacks: false };

vi.mock("../../useSessionWriteBacks", () => ({
  useSessionWriteBacks: () => writeBacksReturn,
}));
vi.mock("../../../execution/WriteBackCard", () => ({
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

    render(<ChangesTab executions={[]} />);
    expect(screen.getByTestId("write-back-card")).toBeTruthy();
  });

  // Local file changes render in the transcript (edit rows + decision bar),
  // never here — the tab is exclusively the write-back (PR) surface.
  it("renders the PR-oriented empty state when no write-back exists", () => {
    render(<ChangesTab executions={[]} />);
    expect(screen.getByText(/no changes yet/i)).toBeTruthy();
    expect(screen.getByText(/pull requests/i)).toBeTruthy();
  });
});
