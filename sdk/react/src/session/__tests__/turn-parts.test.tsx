/**
 * Proves the small parts around a turn's ending: the folded step row leaves
 * a stretch it has no words for (thinking, a subagent, the agent's
 * bookkeeping) as its rows, at the inset every row has; the outcome's card
 * sizes a File in kilobytes or megabytes after its kind, and names
 * only the kind for an empty one, and offers a made File's download where a
 * client is there to fetch it; the change dialog closes on Escape as well as
 * from its button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { DisplayFileChange, Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
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
    // Flush to the thread's one gutter: no edge of its own.
    expect(screen.getByText("the rows").parentElement!.className).not.toContain("stg:mx-4");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TurnOutcome downloads", () => {
  const outcome = {
    runId: "run_1",
    phase: "completed" as const,
    elapsedMs: 3_000,
    files: [samples.outputFile("notes.md", { sizeBytes: 2_048n })],
    changes: [],
    plans: [],
    reviewSets: [],
    estimatedCostUsd: undefined,
  };

  it("offers Download on a made File, minting its link on the click", () => {
    const getDownloadUrl = vi.fn().mockResolvedValue({ url: "" });
    render(
      <StigmerContext.Provider value={{ file: { getDownloadUrl } } as unknown as Stigmer}>
        <TurnOutcome outcome={outcome} onOpenFile={() => {}} />
      </StigmerContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download notes.md" }));
    expect(getDownloadUrl).toHaveBeenCalledWith(outcome.files[0]!.metadata!.id);
  });

  it("offers no Download where no client is there to fetch it", () => {
    render(<TurnOutcome outcome={outcome} onOpenFile={() => {}} />);
    expect(screen.queryByRole("button", { name: "Download notes.md" })).toBeNull();
  });
});

describe("TurnOutcome sizes", () => {
  it("sizes a File in kilobytes or megabytes, and says nothing for an empty one", () => {
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
            samples.outputFile("notes.md", { sizeBytes: 2_048n }),
          ],
          changes: [],
          plans: [],
          reviewSets: [],
          estimatedCostUsd: undefined,
        }}
        onOpenFile={() => {}}
      />,
    );
    const cards = screen.getAllByRole("button").map((card) => card.getAttribute("aria-label"));
    expect(cards).toEqual(["empty.txt Text", "note.txt Text · 0.5 KB", "deck.pdf PDF · 3.0 MB", "notes.md Markdown · 2.0 KB"]);
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
