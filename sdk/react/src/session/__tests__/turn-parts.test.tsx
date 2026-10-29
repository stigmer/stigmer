/**
 * Proves the small parts around a turn's ending: the folded step row leaves
 * a stretch it has no words for (thinking, a subagent, the agent's
 * bookkeeping) as its rows, at the inset every row has; the outcome sizes a File in bytes, kilobytes or
 * megabytes and says nothing for an empty one; the change dialog closes on Escape as
 * well as from its button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { DisplayFileChange } from "@stigmer/client";
import { samples } from "../../test";
import { SettledStepsRow } from "../../run/SettledStepsRow";
import { TurnOutcome } from "../TurnOutcome";
import { TurnChangeDialog } from "../TurnChangeDialog";

vi.mock("../../run/FileChangesView", () => ({
  FileChangeDiff: ({ change }: { change: DisplayFileChange }) => <p>diff of {change.path}</p>,
}));

afterEach(cleanup);

describe("SettledStepsRow", () => {
  it("leaves a stretch it has no words for as its rows", () => {
    render(
      <SettledStepsRow toolUses={[samples.toolUse("think", "noted")]}>
        <p>the rows</p>
      </SettledStepsRow>,
    );
    expect(screen.getByText("the rows").parentElement!.className).toContain("stg:mx-4");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TurnOutcome sizes", () => {
  it("sizes a File in bytes, kilobytes or megabytes, and says nothing for an empty one", () => {
    render(
      <TurnOutcome
        outcome={{
          runId: "run_1",
          phase: "completed",
          elapsedMs: 3_000,
          files: [
            samples.outputFile("empty.txt", { sizeBytes: 0n }),
            samples.outputFile("note.txt", { sizeBytes: 512n }),
            samples.outputFile("deck.pdf", { sizeBytes: 3n * 1024n * 1024n }),
          ],
          changes: [],
          estimatedCostUsd: undefined,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "empty.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "note.txt 512 B" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "deck.pdf 3.0 MB" })).toBeTruthy();
  });
});

describe("TurnChangeDialog", () => {
  const change = { path: "src/billing/invoice.ts" } as DisplayFileChange;

  it("shows the change's diff and closes from its button and on Escape", () => {
    const onClose = vi.fn();
    render(<TurnChangeDialog change={change} onClose={onClose} />);
    expect(screen.getByText("diff of src/billing/invoice.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog", { name: "Change to src/billing/invoice.ts" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is closed while no change is chosen", () => {
    render(<TurnChangeDialog change={null} onClose={() => {}} />);
    expect(screen.queryByText(/diff of/)).toBeNull();
  });
});
