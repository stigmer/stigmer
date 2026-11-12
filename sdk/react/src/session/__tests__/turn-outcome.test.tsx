/**
 * Proves what closes a turn: the outcome (../turn-outcome.ts) gathers the
 * Files the turn itself returned (by run, never an earlier turn's file at the
 * same path), the changes the run captured, else the paths its review sets
 * name, else the paths its edit and write calls named (`path` or the Claude
 * engine's `file_path`) less the Files it saved in its `.stigmer/outputs/`;
 * its time; and its estimated cost, a zero or absent estimate reading as
 * none. The block (../TurnOutcome.tsx) draws what the turn Made and
 * Changed as cards (name, then kind and size or folder) that open each File
 * and change from the conversation itself, a change the viewer cannot show
 * (or anything nothing can open) reading as a plain label; from five items
 * on, a list of the first five, the rest counted by kind (largest first)
 * and "Show all" opening them in place. How a turn ended is the header's
 * pill, and for one that did not finish its notice, so the block says only
 * what the turn produced: it draws nothing for a turn that made and changed
 * nothing, nor for a turn that still works. A File's kind reads in
 * a person's words (`fileKind`): from its type, else its extension.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema, FileChangeSetSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { StreamingUsageSummarySchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { samples, scenarios } from "../../test";
import { turnOutcome, type TurnOutcomeView } from "../turn-outcome";
import { TurnOutcome, fileKind } from "../TurnOutcome";

afterEach(cleanup);

const finished = scenarios.finished;
const finishedTurn = finished.fold.turns[0]!;

describe("turnOutcome", () => {
  it("credits the turn only with the Files its own run returned", () => {
    const earlier = samples.outputFile("invoice-audit.md", { runId: "run_earlier" });
    const outcome = turnOutcome(finishedTurn, [earlier, ...finished.files], finished.runs[0]);
    expect(outcome.files.map((file) => file.spec?.filename)).toEqual(["invoice-audit.md", "rounding-cases.csv"]);
    expect(outcome.files.every((file) => file.status?.runId === finishedTurn.runId)).toBe(true);
  });

  it("names the paths its edit and write calls changed, less the Files it returned, when nothing was captured", () => {
    const outcome = turnOutcome(finishedTurn, finished.files, finished.runs[0]);
    expect(outcome.changes).toEqual([{ path: "src/billing/invoice.ts", captured: undefined }]);
    expect(outcome.phase).toBe("completed");
    expect(outcome.elapsedMs).toBe(74_000);
  });

  it("lists a Claude turn's edit by its file_path, and no call that names no path", () => {
    const turn = samples.turn({
      tools: [
        { name: "Edit", input: { file_path: "src/billing/invoice.ts" }, result: "ok" },
        { name: "Write", input: { content: "no path here" }, result: "ok" },
        { name: "write_file", input: { path: "", file_path: "src/billing/rounding.ts" }, result: "ok" },
        { name: "delete_file", input: { path: 7, file_path: "src/billing/legacy.ts" }, result: "ok" },
      ],
    });
    expect(turnOutcome(turn, [], undefined).changes.map((change) => change.path)).toEqual([
      "src/billing/invoice.ts",
      "src/billing/rounding.ts",
      "src/billing/legacy.ts",
    ]);
  });

  it("leaves out a File the turn saved in its outputs folder, through any workspace prefix, and only there", () => {
    const report = samples.outputFile("report.md");
    const turn = samples.turn({
      tools: [
        { name: "write_file", input: { path: "/home/daytona/workspace/.stigmer/outputs/report.md" }, result: "ok" },
        { name: "edit_file", input: { path: "docs/outputs/report.md" }, result: "ok" },
      ],
    });
    expect(turnOutcome(turn, [report], undefined).changes.map((change) => change.path)).toEqual(["docs/outputs/report.md"]);
  });

  it("prefers the run's captured changes, each with what a dialog diffs", () => {
    const run = samples.run({ id: finishedTurn.runId });
    run.status = create(RunStatusSchema, {
      fileChanges: [
        create(FileChangeSetSchema, {
          id: "cs-1",
          changes: [
            create(CapturedFileChangeSchema, {
              id: "c1",
              pathBefore: "src/billing/rounding.ts",
              pathAfter: "src/billing/rounding.ts",
              kind: FileChangeKind.MODIFY,
              diffComplete: true,
            }),
          ],
        }),
      ],
    });
    const outcome = turnOutcome(finishedTurn, finished.files, run);
    expect(outcome.changes.map((change) => [change.path, change.captured?.path])).toEqual([
      ["src/billing/rounding.ts", "src/billing/rounding.ts"],
    ]);
  });

  it("names the paths a review set holds when the run captured none", () => {
    const review = scenarios["file-review"];
    const outcome = turnOutcome(review.fold.turns[0]!, [], review.runs[0]);
    expect(outcome.changes.map((change) => change.path)).toEqual(["src/billing/invoice.ts", "src/billing/rounding.ts"]);
  });

  it("reads the runner's estimate as the cost, and a zero or absent one as none", () => {
    expect(turnOutcome(finishedTurn, [], finished.runs[0]).estimatedCostUsd).toBe(0.42);
    const free = samples.run({ id: finishedTurn.runId });
    free.status!.streamingUsage = create(StreamingUsageSummarySchema, { estimatedCostUsd: 0 });
    expect(turnOutcome(finishedTurn, [], free).estimatedCostUsd).toBeUndefined();
    expect(turnOutcome(finishedTurn, [], undefined).estimatedCostUsd).toBeUndefined();
  });

  it("has no ending while the turn works", () => {
    expect(turnOutcome(scenarios.busy.fold.turns[0]!, [], undefined).phase).toBeUndefined();
  });
});

/** A completed turn's outcome holding `files` and `changes`. */
function completedWith(files: TurnOutcomeView["files"], changes: readonly string[] = []): TurnOutcomeView {
  return {
    runId: "run_1",
    phase: "completed",
    elapsedMs: 3_000,
    files,
    changes: changes.map((path) => ({ path, captured: undefined })),
    estimatedCostUsd: undefined,
  };
}

describe("TurnOutcome", () => {
  it("KIT-06 opens each File and change the turn produced from the conversation itself", () => {
    const onOpenFile = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TurnOutcome
        outcome={turnOutcome(finishedTurn, finished.files, finished.runs[0])}
        onOpenFile={onOpenFile}
        onOpenChange={onOpenChange}
      />,
    );
    const block = screen.getByRole("region", { name: "What this turn produced" });
    expect(block.textContent).not.toContain("Done");
    expect(within(block).getByRole("group", { name: "Made" })).toBeTruthy();
    expect(within(block).getByRole("group", { name: "Changed" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^invoice-audit\.md\s*Markdown · 4\.1 KB$/ }));
    expect(onOpenFile).toHaveBeenCalledWith(finished.files[0]);
    fireEvent.click(screen.getByRole("button", { name: /^rounding-cases\.csv\s*Spreadsheet · 1\.8 KB$/ }));
    expect(onOpenFile).toHaveBeenCalledWith(finished.files[1]);

    fireEvent.click(screen.getByRole("button", { name: /^invoice\.ts\s*src\/billing$/ }));
    expect(onOpenChange).toHaveBeenCalledWith({ path: "src/billing/invoice.ts", captured: undefined });
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a change this viewer cannot open as a label, not a dead button", () => {
    render(
      <TurnOutcome
        outcome={turnOutcome(finishedTurn, finished.files, finished.runs[0])}
        canOpenChange={(change) => change.captured !== undefined}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /invoice\.ts/ })).toBeNull();
    expect(screen.getByText("invoice.ts")).toBeTruthy();
    // Nothing opens a File here either: each reads as a label.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("invoice-audit.md")).toBeTruthy();
  });

  it("opens a change the viewer can show", () => {
    const onOpenChange = vi.fn();
    render(<TurnOutcome outcome={completedWith([], ["README.md"])} canOpenChange={() => true} onOpenChange={onOpenChange} />);
    // A change at the workspace's root names no folder.
    const button = screen.getByRole("button", { name: "README.md" });
    fireEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledWith({ path: "README.md", captured: undefined });
  });

  it("leaves how a turn that did not finish ended to its notice and the pill: nothing made, nothing drawn", () => {
    const failed = scenarios.failed;
    const outcome = turnOutcome(failed.fold.turns[0]!, [], failed.runs[0]);
    const { container } = render(<TurnOutcome outcome={outcome} />);
    expect(container.textContent).toBe("");
  });

  it("draws nothing under a completed turn that made and changed nothing", () => {
    const { container } = render(<TurnOutcome outcome={completedWith([])} />);
    expect(container.textContent).toBe("");
  });

  it("closes nothing while the turn works", () => {
    const { container } = render(<TurnOutcome outcome={turnOutcome(scenarios.busy.fold.turns[0]!, [], undefined)} />);
    expect(container.textContent).toBe("");
  });

  it("lists five Files or more, counts the rest by kind, largest first, and shows them all in place", () => {
    const onOpenFile = vi.fn();
    const files = [
      samples.outputFile("a.md"),
      samples.outputFile("b.md"),
      samples.outputFile("c.md"),
      samples.outputFile("d.md"),
      samples.outputFile("e.md"),
      samples.outputFile("f.pdf"),
      samples.outputFile("g.md"),
      samples.outputFile("h.pdf"),
      samples.outputFile("i.pdf", { sizeBytes: 2_048n }),
    ];
    render(<TurnOutcome outcome={completedWith(files)} onOpenFile={onOpenFile} />);
    const made = screen.getByRole("group", { name: "Made" });
    expect(made.textContent).toContain("Made · 9 files");
    expect(within(made).getAllByRole("listitem").map((row) => row.textContent)).toEqual(["a.mdMarkdown", "b.mdMarkdown", "c.mdMarkdown", "d.mdMarkdown", "e.mdMarkdown"]);
    expect(within(made).getByText("4 more: 3 PDF, 1 Markdown")).toBeTruthy();

    fireEvent.click(within(made).getByRole("button", { name: "Show all 9" }));
    expect(within(made).getAllByRole("listitem")).toHaveLength(9);
    expect(within(made).queryByRole("button", { name: /^Show all/ })).toBeNull();
    expect(within(made).queryByText(/more:/)).toBeNull();
    fireEvent.click(within(made).getByRole("button", { name: /^i\.pdf\s*PDF · 2\.0 KB$/ }));
    expect(onOpenFile).toHaveBeenCalledWith(files[8]);
  });

  it("lists exactly five items with nothing left to count", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "lib/d.ts", "e.json"];
    render(<TurnOutcome outcome={completedWith([], paths)} />);
    const changed = screen.getByRole("group", { name: "Changed" });
    expect(changed.textContent).toContain("Changed · 5 files");
    expect(within(changed).getAllByRole("listitem").map((row) => row.textContent)).toEqual(["a.tssrc", "b.tssrc", "c.tssrc", "d.tslib", "e.json"]);
    expect(within(changed).queryByRole("button")).toBeNull();
    expect(within(changed).queryByText(/more:/)).toBeNull();
  });

  it("draws four items as cards, never a list", () => {
    render(<TurnOutcome outcome={completedWith([], ["a.ts", "b.ts", "c.ts", "d.ts"])} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("group", { name: "Changed" }).textContent).toMatch(/^Changeda\.ts/);
  });
});

describe("fileKind", () => {
  it("names a File's kind from its type, else its extension", () => {
    expect(fileKind("notes", "text/markdown")).toBe("Markdown");
    expect(fileKind("NOTES.MD", "")).toBe("Markdown");
    expect(fileKind("cases", "text/csv")).toBe("Spreadsheet");
    expect(fileKind("cases.csv", "")).toBe("Spreadsheet");
    expect(fileKind("ledger.xlsx", "application/octet-stream")).toBe("Spreadsheet");
    expect(fileKind("deck", "application/pdf")).toBe("PDF");
    expect(fileKind("deck.pdf", "")).toBe("PDF");
    expect(fileKind("data", "application/json")).toBe("JSON");
    expect(fileKind("data.json", "")).toBe("JSON");
    expect(fileKind("chart.png", "image/png")).toBe("Image");
    expect(fileKind("log", "text/plain")).toBe("Text");
    expect(fileKind("log.txt", "")).toBe("Text");
    expect(fileKind("bundle.tar.gz", "")).toBe("GZ");
    expect(fileKind("Makefile", "")).toBe("File");
  });
});
