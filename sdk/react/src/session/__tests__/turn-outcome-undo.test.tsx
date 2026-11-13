/**
 * Proves a turn's edited files show once, under its answer, with Undo
 * (../turn-outcome.ts, ../TurnOutcome.tsx): each change carries the file of
 * its turn's review (matched as the rows' badges match, so an absolute path
 * still finds it); a card says what happened in words (New, Deleted,
 * Renamed from …, nothing for an edit), its line counts, and a state only
 * when it says something (Undoing…, Undone, Couldn't undo with Try again).
 * Undo is offered only when the host passes it (the viewer decides, on the
 * newest turn), per undecided file and, with two or more undecided, for all;
 * all of an undecided set is one decision, the rest of a partly decided set
 * one per file. What still stands is what the header counts. No Keep,
 * Approve, Reject or "reviewed" word appears anywhere.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { FileReviewFile, FileReviewSet, Turn } from "@stigmer/client";
import { samples } from "../../test";
import { standingChanges, turnOutcome } from "../turn-outcome";
import { TurnOutcome, type TurnOutcomeUndo } from "../TurnOutcome";
import { changeWords } from "../turn-change-words";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

afterEach(cleanup);

function reviewFile(id: string, path: string, overrides: Partial<FileReviewFile> = {}): FileReviewFile {
  return {
    fileChangeId: id,
    path,
    previousPath: "",
    change: "modified",
    digest: `fd-${id}`,
    linesAdded: 12,
    linesRemoved: 4,
    reviewable: "complete",
    state: "undecided",
    decidedBy: "",
    ...overrides,
  };
}

function reviewSet(files: FileReviewFile[]): FileReviewSet {
  return {
    changeSetId: "cs-1",
    runId: samples.run().metadata!.id,
    aggregateDigest: "agg-1",
    files,
    decisions: [],
    reconciles: [],
    undecided: files.some((file) => file.state === "undecided"),
    processedAt: "2026-07-20T11:00:00.000Z",
  };
}

function turnWith(files: FileReviewFile[]): Turn {
  return { ...samples.turn({ tools: [{ name: "edit_file", input: { path: "/workspace/src/billing/invoice.ts" }, result: "1 edit applied" }] }), fileReview: [reviewSet(files)] };
}

function undoProps(overrides: Partial<TurnOutcomeUndo> = {}): TurnOutcomeUndo {
  return { onUndo: vi.fn(), busyKeys: new Set(), errors: new Map(), ...overrides };
}

describe("turnOutcome: a change and its review file", () => {
  it("matches each changed path to its turn's review file, an absolute path included", () => {
    const invoice = reviewFile("f1", "src/billing/invoice.ts");
    const outcome = turnOutcome(turnWith([invoice]), [], undefined);
    expect(outcome.changes).toHaveLength(1);
    expect(outcome.changes[0]?.review).toEqual({ changeSetId: "cs-1", file: invoice });
  });

  it("counts what still stands: an undone file drops out, one undoing or whose undo failed stays", () => {
    const outcome = turnOutcome(
      turnWith([
        reviewFile("f1", "src/billing/invoice.ts", { state: "undone" }),
        reviewFile("f2", "src/billing/rounding.ts", { state: "undo_failed", change: "added" }),
        reviewFile("f3", "src/billing/credit-note.ts", { state: "undoing" }),
      ]),
      [],
      undefined,
    );
    expect(standingChanges(outcome).map((change) => change.path)).toEqual(["src/billing/rounding.ts", "src/billing/credit-note.ts"]);
  });
});

describe("changeWords", () => {
  it("says what happened in words, from the review's word or the live capture's kind, nothing for an edit", () => {
    expect(changeWords("added")).toBe("New");
    expect(changeWords("deleted")).toBe("Deleted");
    expect(changeWords("renamed", "src/billing/round.ts")).toBe("Renamed from round.ts");
    expect(changeWords("modified")).toBe("");
    expect(changeWords(FileChangeKind.ADD)).toBe("New");
    expect(changeWords(FileChangeKind.DELETE)).toBe("Deleted");
    expect(changeWords(FileChangeKind.MODIFY)).toBe("");
  });
});

describe("KIT-14 a turn's changed and made files appear once, and only someone who may decide sees Undo", () => {
  it("draws each changed file once, with its line counts, and no review words", () => {
    const outcome = turnOutcome(turnWith([reviewFile("f1", "src/billing/invoice.ts"), reviewFile("f2", "src/billing/rounding.ts", { change: "added", linesAdded: 30, linesRemoved: 0 })]), [], undefined);
    render(<TurnOutcome outcome={outcome} undo={undoProps()} />);
    const changed = screen.getByRole("group", { name: "Changed" });
    expect(within(changed).getAllByText("invoice.ts")).toHaveLength(1);
    expect(within(changed).getByText("src/billing · New")).toBeTruthy();
    expect(within(changed).getByLabelText("30 added, 0 removed")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Keep|Approve|Reject|reviewed|Discard/);
  });

  it("offers no Undo when the host passes none (a reader, a teammate, a guest, an older turn)", () => {
    const outcome = turnOutcome(turnWith([reviewFile("f1", "src/billing/invoice.ts")]), [], undefined);
    render(<TurnOutcome outcome={outcome} />);
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("undoes one file by its own decision, against its digest", () => {
    const onUndo = vi.fn();
    const invoice = reviewFile("f1", "src/billing/invoice.ts");
    render(<TurnOutcome outcome={turnOutcome(turnWith([invoice]), [], undefined)} undo={undoProps({ onUndo })} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo invoice.ts" }));
    expect(onUndo).toHaveBeenCalledWith("cs-1", { scope: "file", fileChangeId: "f1", expectedDigest: "fd-f1" });
    expect(screen.queryByRole("button", { name: "Undo all" })).toBeNull();
  });

  it("undoes an undecided set in one decision, and only the undecided files of a partly decided one", () => {
    const onUndo = vi.fn();
    const files = [reviewFile("f1", "src/billing/invoice.ts"), reviewFile("f2", "src/billing/rounding.ts")];
    const { unmount } = render(<TurnOutcome outcome={turnOutcome(turnWith(files), [], undefined)} undo={undoProps({ onUndo })} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }));
    expect(onUndo).toHaveBeenCalledWith("cs-1", { scope: "change_set", expectedDigest: "agg-1" });
    unmount();

    const partly = vi.fn();
    const mixed = [
      reviewFile("f1", "src/billing/invoice.ts", { state: "undone" }),
      reviewFile("f2", "src/billing/rounding.ts"),
      reviewFile("f3", "src/billing/credit-note.ts"),
    ];
    render(<TurnOutcome outcome={turnOutcome(turnWith(mixed), [], undefined)} undo={undoProps({ onUndo: partly })} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }));
    expect(partly.mock.calls).toEqual([
      ["cs-1", { scope: "file", fileChangeId: "f2", expectedDigest: "fd-f2" }],
      ["cs-1", { scope: "file", fileChangeId: "f3", expectedDigest: "fd-f3" }],
    ]);
  });

  it("says Undoing… while a file's undo is sent or put back, Undone once it is, and Couldn't undo with Try again when it failed", () => {
    const onUndo = vi.fn();
    const files = [
      reviewFile("f1", "src/billing/invoice.ts", { state: "undone" }),
      reviewFile("f2", "src/billing/rounding.ts", { state: "undo_failed" }),
      reviewFile("f3", "src/billing/credit-note.ts", { state: "undoing" }),
      reviewFile("f4", "src/billing/line.ts"),
    ];
    render(<TurnOutcome outcome={turnOutcome(turnWith(files), [], undefined)} undo={undoProps({ onUndo, busyKeys: new Set(["cs-1:f4"]) })} />);
    const changed = screen.getByRole("group", { name: "Changed" });
    expect(within(changed).getByText("Undone")).toBeTruthy();
    expect(within(changed).getByText("Couldn't undo")).toBeTruthy();
    expect(within(changed).getAllByText("Undoing…")).toHaveLength(2);
    fireEvent.click(within(changed).getByRole("button", { name: "Try again" }));
    expect(onUndo).toHaveBeenCalledWith("cs-1", { scope: "file", fileChangeId: "f2", expectedDigest: "fd-f2" });
    expect(screen.getByRole("status").textContent).toContain("1 undone");
  });

  it("names a refused undo on its file, with Try again", () => {
    const onUndo = vi.fn();
    const files = [reviewFile("f1", "src/billing/invoice.ts")];
    render(<TurnOutcome outcome={turnOutcome(turnWith(files), [], undefined)} undo={undoProps({ onUndo, errors: new Map([["cs-1:f1", new Error("the change no longer matches")]]) })} />);
    expect(screen.getByText("Couldn't undo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onUndo).toHaveBeenCalledWith("cs-1", { scope: "file", fileChangeId: "f1", expectedDigest: "fd-f1" });
  });

  it("opens a change from its name, with Undo beside it rather than inside it", () => {
    const onOpenChange = vi.fn();
    render(
      <TurnOutcome outcome={turnOutcome(turnWith([reviewFile("f1", "src/billing/invoice.ts")]), [], undefined)} onOpenChange={onOpenChange} undo={undoProps()} />,
    );
    const open = screen.getByRole("button", { name: /^invoice\.ts/ });
    const undo = screen.getByRole("button", { name: "Undo invoice.ts" });
    expect(open.contains(undo)).toBe(false);
    expect(undo.contains(open)).toBe(false);
    fireEvent.click(open);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("says nothing on a kept file, and offers it no Undo", () => {
    const files = [reviewFile("f1", "src/billing/invoice.ts", { state: "kept" }), reviewFile("f2", "src/billing/rounding.ts")];
    render(<TurnOutcome outcome={turnOutcome(turnWith(files), [], undefined)} undo={undoProps()} />);
    expect(screen.queryByRole("button", { name: "Undo invoice.ts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo rounding.ts" })).toBeTruthy();
    expect(screen.queryByText("Undone")).toBeNull();
  });

  it("undoes all across a turn's sets, skipping a set nothing in which is undecided", () => {
    const onUndo = vi.fn();
    const turn = turnWith([reviewFile("f1", "src/billing/invoice.ts")]);
    const decided: FileReviewSet = { ...reviewSet([reviewFile("g1", "src/billing/line.ts", { state: "undone" })]), changeSetId: "cs-0", undecided: false };
    const open: FileReviewSet = { ...reviewSet([reviewFile("f2", "src/billing/rounding.ts"), reviewFile("f3", "src/billing/credit-note.ts")]), changeSetId: "cs-2" };
    render(<TurnOutcome outcome={turnOutcome({ ...turn, fileReview: [decided, ...turn.fileReview, open] }, [], undefined)} undo={undoProps({ onUndo })} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }));
    expect(onUndo.mock.calls.map(([id]) => id)).toEqual(["cs-1", "cs-2"]);
  });

  it("says a binary file is binary, with no line counts", () => {
    render(<TurnOutcome outcome={turnOutcome(turnWith([reviewFile("f1", "src/billing/invoice.ts", { reviewable: "binary", linesAdded: 0, linesRemoved: 0 })]), [], undefined)} />);
    expect(screen.getByText("Binary")).toBeTruthy();
  });
});
