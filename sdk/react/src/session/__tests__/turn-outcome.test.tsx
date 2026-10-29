/**
 * Proves what closes a turn: the outcome (../turn-outcome.ts) gathers the
 * Files the turn itself returned (by run, never an earlier turn's file at the
 * same path), the changes the run captured, else the paths its review sets
 * name, else the paths its edit and write calls named (`path` or the Claude
 * engine's `file_path`) less the Files it saved in its `.stigmer/outputs/`;
 * its time; and its estimated cost, a zero or absent estimate reading as
 * none. The block (../TurnOutcome.tsx) says how the turn ended
 * and opens each File and change from the conversation itself, a change the
 * viewer cannot show reading as a plain label. Nothing closes a turn that
 * still works.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema, FileChangeSetSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { StreamingUsageSummarySchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { samples, scenarios } from "../../test";
import { turnOutcome } from "../turn-outcome";
import { TurnOutcome } from "../TurnOutcome";

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
    expect(block.textContent).toContain("Done · 1 min 14 s");

    fireEvent.click(screen.getByRole("button", { name: /invoice-audit\.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith(finished.files[0]);
    expect(screen.getByRole("button", { name: /rounding-cases\.csv\s*1\.8 KB/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "invoice.ts" }));
    expect(onOpenChange).toHaveBeenCalledWith({ path: "src/billing/invoice.ts", captured: undefined });
  });

  it("shows a change this viewer cannot open as a label, not a dead button", () => {
    render(
      <TurnOutcome
        outcome={turnOutcome(finishedTurn, finished.files, finished.runs[0])}
        canOpenChange={(change) => change.captured !== undefined}
        onOpenChange={() => {}}
      />,
    );
    expect((screen.getByRole("button", { name: "invoice.ts" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says how a turn that did not finish ended", () => {
    const failed = scenarios.failed;
    render(<TurnOutcome outcome={turnOutcome(failed.fold.turns[0]!, [], failed.runs[0])} />);
    expect(screen.getByRole("region").textContent).toContain("Failed");
  });

  it("closes nothing while the turn works", () => {
    const { container } = render(<TurnOutcome outcome={turnOutcome(scenarios.busy.fold.turns[0]!, [], undefined)} />);
    expect(container.textContent).toBe("");
  });
});
