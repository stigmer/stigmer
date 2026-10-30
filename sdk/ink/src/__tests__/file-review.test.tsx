// Pins the terminal file-review surfaces on folded session events: the
// decision prompt (bulk keep/undo bound to the set's digest, the per-file
// mode bound to each file's digest, binary acknowledgement, blocked files,
// in-flight and error states, the master-detail diff from the run's
// captured bytes), the edit rows' badges and a group's cue from the turn's
// review, the settled record, the shared line stats and block reasons, the
// thread's records, and the whole-file diff body.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import { FileReviewContext } from "@stigmer/react-core";
import { samples } from "@stigmer/react-sdk/test";
import {
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";
import type { FileContent } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewSet, ToolUse } from "@stigmer/client";
import { ToolCallItem } from "../components/ToolCallItem.js";
import { ToolCallGroup } from "../components/ToolCallGroup.js";
import { FileReviewPrompt } from "../components/FileReviewPrompt.js";
import { FileReviewRecord } from "../components/FileReviewRecord.js";
import { FileDiffBody } from "../components/FileDiffBody.js";
import { renderOnTerminal, settle as settleTerminal } from "./fake-terminal.js";
import { MessageThread } from "../components/MessageThread.js";
import { FileLineStats } from "../components/FileReviewAtoms.js";
import { blockReasonNote, changeSetLineStats, editedPath, settledCounts } from "../file-review.js";
import { fakeClient, renderWithClient } from "./test-support.js";
import { RUN_ID, reviewEvents, reviewSet, turnOf, type ReviewFileInit } from "./session-events.js";

// --- fixtures -------------------------------------------------------------

/** An edit of `path` by the demo run, returned. */
function editOf(path: string, name = "write_file"): ToolUse {
  return samples.toolUse(name, "ok", { id: `${RUN_ID}.edit-${path}`, input: { path } });
}

function renderRow(toolUse: ToolUse, sets: readonly FileReviewSet[]) {
  return render(
    <FileReviewContext.Provider
      value={{ fileReviewByRunId: new Map([[RUN_ID, sets]]), changeSetsById: new Map() }}
    >
      <ToolCallItem toolUse={toolUse} />
    </FileReviewContext.Provider>,
  );
}

const TWO_FILES: readonly ReviewFileInit[] = [
  { id: "a", path: "one.ts" },
  { id: "b", path: "two.ts" },
];

// --- FileReviewPrompt: bulk ----------------------------------------------

describe("FileReviewPrompt — bulk", () => {
  const completeSet = reviewSet(TWO_FILES);

  it("shows the summary and complete-set bulk actions", () => {
    const out = render(<FileReviewPrompt fileReviewSet={completeSet} onSubmit={() => {}} />).lastFrame() ?? "";
    expect(out).toContain("2 files awaiting review");
    expect(out).toContain("[a] Approve all");
    expect(out).toContain("[r] Reject all");
    expect(out).toContain("[f] Review files");
  });

  it("keeps the whole set with the aggregate digest (no acknowledge)", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<FileReviewPrompt fileReviewSet={completeSet} onSubmit={onSubmit} />);
    stdin.write("a");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "keep", {
      scope: "change_set",
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("undoes the whole set", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<FileReviewPrompt fileReviewSet={completeSet} onSubmit={onSubmit} />);
    stdin.write("r");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "undo", {
      scope: "change_set",
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("labels a binary-only set 'Keep all' and acknowledges on keep", () => {
    const binarySet = reviewSet([
      { id: "img", path: "logo.png", reviewable: "binary" },
      { id: "txt", path: "readme.md" },
    ]);
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={binarySet} onSubmit={onSubmit} />);
    expect(lastFrame() ?? "").toContain("[a] Keep all");
    stdin.write("a");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "keep", {
      scope: "change_set",
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: true,
    });
  });

  it("hides bulk keep for a blocked set (no [a]); reject + review only", () => {
    const blockedSet = reviewSet([
      { id: "s", path: ".env", reviewable: "secret" },
      { id: "ok", path: "app.ts" },
    ]);
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={blockedSet} onSubmit={onSubmit} />);
    const out = lastFrame() ?? "";
    expect(out).not.toContain("[a]");
    expect(out).toContain("[r] Reject all");
    expect(out).toContain("[f] Review files");
    stdin.write("a"); // no bulk-keep option → ignored
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reads 'remaining' once some files are decided, and a single file plainly", () => {
    const partly = reviewSet(TWO_FILES, [{ id: "d1", action: "keep", fileChangeId: "a" }]);
    expect(render(<FileReviewPrompt fileReviewSet={partly} onSubmit={() => {}} />).lastFrame()).toContain(
      "[a] Approve remaining",
    );
    const single = reviewSet([{ id: "a", path: "one.ts" }]);
    const out = render(<FileReviewPrompt fileReviewSet={single} onSubmit={() => {}} />).lastFrame() ?? "";
    expect(out).toContain("1 file awaiting review");
    expect(out).toContain("[a] Approve");
    expect(out).toContain("[r] Reject");
  });
});

// --- FileReviewPrompt: per-file ------------------------------------------

/** Let ink/React flush a state transition between keystrokes. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("FileReviewPrompt — per-file", () => {
  const blockedSet = reviewSet([
    { id: "ok", path: "app.ts" },
    { id: "s", path: ".env", reviewable: "secret" },
  ]);

  it("enters per-file mode and keeps a reviewable file with its file digest", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={blockedSet} onSubmit={onSubmit} />);
    stdin.write("f");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("app.ts");
    expect(out).toContain(".env");
    expect(out).toContain("contents withheld");
    expect(out).toContain("keep"); // hint line
    expect(out).toContain("No diff available."); // no captured bytes held
    stdin.write("k"); // keep the selected (first) file
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "keep", {
      scope: "file",
      fileChangeId: "ok",
      expectedDigest: "fd-ok",
      acknowledgeUnreviewable: false,
    });
  });

  it("refuses to keep an unavailable file but allows discard, and moves both ways", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={blockedSet} onSubmit={onSubmit} />);
    stdin.write("f");
    await tick();
    stdin.write("\u001B[A"); // up wraps → the secret file
    await tick();
    stdin.write("\u001B[B"); // down wraps → the first file
    await tick();
    stdin.write("\u001B[B"); // down → the secret file
    await tick();
    stdin.write("k"); // keep refused for unavailable
    expect(onSubmit).not.toHaveBeenCalled();
    stdin.write("d"); // discard allowed
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "undo", {
      scope: "file",
      fileChangeId: "s",
      expectedDigest: "fd-s",
      acknowledgeUnreviewable: false,
    });
    stdin.write("\u001B"); // esc → back to the bulk options
    await tick();
    expect(lastFrame() ?? "").toContain("[r] Reject all");
  });

  it("decides nothing in per-file mode for a set that holds no files", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<FileReviewPrompt fileReviewSet={reviewSet([])} onSubmit={onSubmit} />);
    stdin.write("f");
    await tick();
    stdin.write("k");
    stdin.write("d");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a binary file with an acknowledgement", async () => {
    const binarySet = reviewSet([{ id: "img", path: "logo.png", reviewable: "binary" }]);
    const onSubmit = vi.fn();
    const { stdin } = render(<FileReviewPrompt fileReviewSet={binarySet} onSubmit={onSubmit} />);
    stdin.write("f");
    await tick();
    stdin.write("k");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", "keep", {
      scope: "file",
      fileChangeId: "img",
      expectedDigest: "fd-img",
      acknowledgeUnreviewable: true,
    });
  });

  it("labels each decided file and shows a rename's source", async () => {
    const set = reviewSet(
      [
        { id: "a", path: "one.ts" },
        { id: "b", path: "two.ts" },
        { id: "c", path: "new.ts", previousPath: "old.ts", change: "renamed" },
      ],
      [
        { id: "d1", action: "keep", fileChangeId: "a" },
        { id: "d2", action: "undo", fileChangeId: "b", reconciled: false },
      ],
    );
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={set} onSubmit={() => {}} />);
    stdin.write("f");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("(kept)");
    expect(out).toContain("(undo failed)");
    expect(out).toContain("old.ts → new.ts");
  });
});

// --- FileReviewPrompt: state ---------------------------------------------

describe("FileReviewPrompt — state", () => {
  const set = reviewSet([{ id: "a", path: "one.ts" }]);

  it("shows submitting and ignores input while a decision is in flight", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt fileReviewSet={set} onSubmit={onSubmit} submittingDecisionKeys={new Set(["other", "cs-1"])} />,
    );
    expect(lastFrame() ?? "").toContain("Submitting");
    stdin.write("a");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is not busy for another set's decision", () => {
    const out = render(
      <FileReviewPrompt fileReviewSet={set} onSubmit={() => {}} submittingDecisionKeys={new Set(["other"])} />,
    ).lastFrame() ?? "";
    expect(out).not.toContain("Submitting");
  });

  it("renders this set's decision error, not another's", () => {
    const out = render(
      <FileReviewPrompt
        fileReviewSet={set}
        onSubmit={() => {}}
        decisionErrors={new Map([
          ["other", new Error("not ours")],
          ["cs-1:a", new Error("digest mismatch")],
        ])}
      />,
    ).lastFrame() ?? "";
    expect(out).toContain("digest mismatch");
    expect(out).not.toContain("not ours");
    expect(
      render(
        <FileReviewPrompt fileReviewSet={set} onSubmit={() => {}} decisionErrors={new Map([["other", new Error("x")]])} />,
      ).lastFrame(),
    ).not.toContain("Decision failed");
  });

  it("is inert and hints when isActive is false", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt fileReviewSet={set} onSubmit={onSubmit} isActive={false} />,
    );
    stdin.write("a");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("Resolve the pending approval first");
  });
});

// --- Row badges -----------------------------------------------------------

describe("ToolCallItem — file-review badge", () => {
  it("badges an undecided file as 'Pending review'", () => {
    const set = reviewSet([{ id: "a", path: "notes.md" }]);
    expect(renderRow(editOf("notes.md"), [set]).lastFrame() ?? "").toContain("Pending review");
  });

  it("badges a kept file as 'Kept', an undone one as 'Discarded', a failed undo as 'Review failed'", () => {
    const files = [{ id: "a", path: "notes.md" }];
    const kept = reviewSet(files, [{ id: "d", action: "keep", fileChangeId: "a" }]);
    expect(renderRow(editOf("notes.md"), [kept]).lastFrame() ?? "").toContain("Kept");
    const undone = reviewSet(files, [{ id: "d", action: "undo", fileChangeId: "a", reconciled: true }]);
    expect(renderRow(editOf("notes.md"), [undone]).lastFrame() ?? "").toContain("Discarded");
    const failed = reviewSet(files, [{ id: "d", action: "undo", reconciled: false }]);
    expect(renderRow(editOf("notes.md"), [failed]).lastFrame() ?? "").toContain("Review failed");
  });

  it("matches an absolute row path to its workspace-relative file", () => {
    const set = reviewSet([{ id: "a", path: "src/notes.md" }]);
    expect(renderRow(editOf("/home/daytona/workspace/src/notes.md"), [set]).lastFrame() ?? "").toContain(
      "Pending review",
    );
  });

  it("shows no badge for a row that edits no file, or a turn with no review", () => {
    const set = reviewSet([{ id: "a", path: "notes.md" }]);
    const read = samples.toolUse("read_file", "x", { input: { path: "notes.md" } });
    expect(renderRow(read, [set]).lastFrame() ?? "").not.toContain("Pending review");
    expect(renderRow(editOf("notes.md"), []).lastFrame() ?? "").not.toContain("Pending review");
  });

  it("shows no badge when the edited path is absent from the review", () => {
    const decided = reviewSet([{ id: "a", path: "other.md" }], [{ id: "d", action: "keep" }]);
    expect(renderRow(editOf("notes.md"), [decided]).lastFrame() ?? "").not.toContain("Kept");
  });
});

describe("editedPath", () => {
  it("names the file a write, edit or delete changed, and nothing for another tool", () => {
    expect(editedPath(editOf("a.ts", "write_file"))).toBe("a.ts");
    expect(editedPath(editOf("b.ts", "edit_file"))).toBe("b.ts");
    expect(editedPath(editOf("c.ts", "delete_file"))).toBe("c.ts");
    expect(editedPath(samples.toolUse("read_file", "x", { input: { path: "d.ts" } }))).toBeNull();
  });
});

// --- Collapsed-group aggregate cue ---------------------------------------

describe("ToolCallGroup — aggregate review cue", () => {
  function renderGroup(toolUses: readonly ToolUse[], sets: readonly FileReviewSet[]) {
    return render(
      <FileReviewContext.Provider value={{ fileReviewByRunId: new Map([[RUN_ID, sets]]), changeSetsById: new Map() }}>
        <ToolCallGroup toolUses={toolUses} />
      </FileReviewContext.Provider>,
    ).lastFrame() ?? "";
  }

  it("surfaces a pending edit on the collapsed summary", () => {
    const set = reviewSet([{ id: "a", path: "notes.md" }]);
    expect(renderGroup([editOf("notes.md")], [set])).toContain("1 pending review");
  });

  it("surfaces a failed undo, then a settled tally", () => {
    const files = [{ id: "a", path: "a.md" }, { id: "b", path: "b.md" }];
    const failed = reviewSet(files, [{ id: "d", action: "undo", reconciled: false }]);
    expect(renderGroup([editOf("a.md")], [failed])).toContain("1 review failed");
    const settled = reviewSet(files, [
      { id: "d1", action: "keep", fileChangeId: "a" },
      { id: "d2", action: "undo", fileChangeId: "b", reconciled: true },
    ]);
    expect(renderGroup([editOf("a.md"), editOf("b.md")], [settled])).toContain("1 kept · 1 discarded");
  });

  it("shows no cue when no row edited a reviewed file", () => {
    const out = render(<ToolCallGroup toolUses={[samples.toolUse("read_file", "x")]} />).lastFrame() ?? "";
    expect(out).not.toContain("pending review");
  });
});

// --- Settled record -------------------------------------------------------

describe("FileReviewRecord", () => {
  it("summarizes kept/discarded and lists files", () => {
    const set = reviewSet(
      [
        { id: "a", path: "one.ts" },
        { id: "b", path: "two.ts" },
        { id: "c", path: "three.ts" },
      ],
      [
        { id: "d1", action: "keep", fileChangeId: "a" },
        { id: "d2", action: "keep", fileChangeId: "b" },
        { id: "d3", action: "undo", fileChangeId: "c", reconciled: true },
      ],
    );
    const out = render(<FileReviewRecord fileReviewSet={set} />).lastFrame() ?? "";
    expect(out).toContain("2 kept · 1 discarded");
    expect(out).toContain("one.ts");
    expect(out).toContain("(discarded)");
  });

  it("reports an undo that could not put the files back, and files never reviewed", () => {
    const set = reviewSet(TWO_FILES, [{ id: "d", action: "undo", fileChangeId: "a", reconciled: false }]);
    const out = render(<FileReviewRecord fileReviewSet={set} />).lastFrame() ?? "";
    expect(out).toContain("1 could not be put back · 1 not reviewed");
    expect(out).toContain("(undo failed)");
    expect(out).toContain("(not reviewed)");
  });

  it("reads a set nobody decided as files changed", () => {
    expect(render(<FileReviewRecord fileReviewSet={reviewSet(TWO_FILES)} />).lastFrame()).toContain(
      "2 files changed",
    );
  });
});

describe("settledCounts and blockReasonNote", () => {
  it("counts an undo still being put back as discarded", () => {
    const set = reviewSet(TWO_FILES, [{ id: "d", action: "undo", fileChangeId: "a" }]);
    expect(settledCounts(set)).toEqual({ kept: 0, discarded: 1, failed: 0, notReviewed: 1 });
  });

  it("explains each kind of file that cannot be kept as-is", () => {
    expect(blockReasonNote({ reviewable: "complete" })).toBeNull();
    expect(blockReasonNote({ reviewable: "binary" })).toContain("binary");
    expect(blockReasonNote({ reviewable: "secret" })).toContain("contents withheld");
    expect(blockReasonNote({ reviewable: "partial" })).toBe("diff unavailable — discard only");
  });
});

// --- MessageThread integration -------------------------------------------

describe("MessageThread — file-review integration", () => {
  function turnWithEdit(phase: "completed" | "running", decided: boolean) {
    return turnOf([
      ...samples.turnEvents({
        message: "Edit the notes",
        tools: [{ name: "write_file", input: { path: "notes.md" }, result: "ok" }],
        reply: "Edited.",
        phase,
      }),
      ...reviewEvents(
        [{ id: "a", path: "notes.md" }],
        decided ? [{ id: "d", action: "keep", fileChangeId: "a" }] : [],
      ),
    ]);
  }

  it("badges a settled row and appends a settled record for an ended turn", () => {
    // Off a live screen the thread is one frame, so its rows badge.
    const out = render(
      <MessageThread turns={[turnWithEdit("completed", true)]} showFileReviewRecords expandToolCalls live={false} />,
    ).lastFrame() ?? "";
    expect(out).toContain("Kept"); // per-row badge
    expect(out).toContain("File review — 1 kept"); // settled record
  });

  it("writes a row to the history without a badge, and the decided set's record once", async () => {
    const turn = turnWithEdit("completed", true);
    const { instance, stdout } = renderOnTerminal(<MessageThread turns={[turn]} showFileReviewRecords expandToolCalls />);
    await settleTerminal();
    instance.rerender(<MessageThread turns={[{ ...turn }]} showFileReviewRecords expandToolCalls />);
    await settleTerminal();
    instance.unmount();
    const out = stdout.output();
    expect(out).not.toContain("Kept");
    expect(out.split("File review — 1 kept")).toHaveLength(2);
  });

  it("does not record an undecided set on a live turn (that is the prompt's job)", () => {
    const out = render(
      <MessageThread turns={[turnWithEdit("running", false)]} showFileReviewRecords expandToolCalls live={false} />,
    ).lastFrame() ?? "";
    expect(out).toContain("Pending review"); // the row still badges
    expect(out).not.toContain("File review —"); // but no settled record
  });

  it("does not record an undecided set once its turn ended either: the record waits for the last decision", () => {
    const out = render(
      <MessageThread turns={[turnWithEdit("completed", false)]} showFileReviewRecords live={false} />,
    ).lastFrame() ?? "";
    expect(out).not.toContain("File review —");
  });

  it("renders the diff of a write from its run's captured bytes", async () => {
    const turn = turnWithEdit("running", false);
    const run = samples.run({ phase: undefined });
    run.status!.fileChanges = [
      create(FileChangeSetSchema, {
        id: "cs-1",
        changes: [
          create(CapturedFileChangeSchema, {
            id: "a",
            pathAfter: "notes.md",
            pathBefore: "notes.md",
            kind: FileChangeKind.MODIFY,
            diffComplete: true,
            before: create(FileContentSchema, { body: { case: "inline", value: "old\n" } }),
            after: create(FileContentSchema, { body: { case: "inline", value: "new\n" } }),
          }),
        ],
      }),
    ];
    const prompt = renderWithClient(
      <FileReviewPrompt
        fileReviewSet={turn.fileReview[0]!}
        capture={run.status!.fileChanges[0]!}
        onSubmit={() => {}}
      />,
    );
    prompt.stdin.write("f");
    await tick();
    expect(prompt.lastFrame() ?? "").toContain("+new");
    // The thread's context carries the same bytes for its rows.
    expect(render(<MessageThread turns={[turn]} runs={[run]} />).lastFrame()).toContain("Edited.");
  });
});

// --- FileLineStats (shared atom) -----------------------------------------

describe("FileLineStats", () => {
  it("renders nothing when both counts are zero (never +0 -0)", () => {
    const { lastFrame } = render(<FileLineStats linesAdded={0} linesRemoved={0} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  it("renders +N -M when counts exist", () => {
    const out = render(<FileLineStats linesAdded={7} linesRemoved={3} />).lastFrame() ?? "";
    expect(out).toContain("+7");
    expect(out).toContain("-3");
  });

  it("renders a one-sided stat (added only) without hiding it", () => {
    const out = render(<FileLineStats linesAdded={5} linesRemoved={0} />).lastFrame() ?? "";
    expect(out).toContain("+5");
    expect(out).toContain("-0"); // both sides always shown once any count exists
  });
});

// --- changeSetLineStats (pure helper) ------------------------------------

describe("changeSetLineStats", () => {
  it("sums per-file counts across the set", () => {
    const set = reviewSet([
      { id: "a", path: "one.ts", linesAdded: 10, linesRemoved: 2 },
      { id: "b", path: "two.ts", linesAdded: 5, linesRemoved: 3 },
    ]);
    expect(changeSetLineStats(set)).toEqual({ linesAdded: 15, linesRemoved: 5 });
  });

  it("is zero for a set whose files carry no counts (stat then hidden by the atom)", () => {
    expect(changeSetLineStats(reviewSet([{ id: "a", path: "one.ts" }]))).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });
});

// --- Line stats on the review surfaces -----------------------------------

describe("FileReviewPrompt — line stats", () => {
  it("shows the set aggregate +N -M on the header", () => {
    const set = reviewSet([
      { id: "a", path: "one.ts", linesAdded: 12, linesRemoved: 3 },
      { id: "b", path: "two.ts", linesAdded: 4, linesRemoved: 1 },
    ]);
    const out = render(<FileReviewPrompt fileReviewSet={set} onSubmit={() => {}} />).lastFrame() ?? "";
    expect(out).toContain("2 files awaiting review");
    expect(out).toContain("+16");
    expect(out).toContain("-4");
  });

  it("hides the header aggregate when no file has counts (never +0 -0)", () => {
    const out = render(
      <FileReviewPrompt fileReviewSet={reviewSet([{ id: "a", path: "one.ts" }])} onSubmit={() => {}} />,
    ).lastFrame() ?? "";
    expect(out).not.toContain("+");
  });

  it("shows per-file +N -M in per-file mode", async () => {
    const set = reviewSet([
      { id: "a", path: "one.ts", linesAdded: 10, linesRemoved: 2 },
      { id: "b", path: "two.ts", linesAdded: 4, linesRemoved: 0 },
    ]);
    const { stdin, lastFrame } = render(<FileReviewPrompt fileReviewSet={set} onSubmit={() => {}} />);
    stdin.write("f");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("+10");
    expect(out).toContain("+4");
  });
});

describe("FileReviewRecord — line stats", () => {
  it("shows the set aggregate and per-file +N -M", () => {
    const set = reviewSet(
      [
        { id: "a", path: "one.ts", linesAdded: 9, linesRemoved: 2 },
        { id: "b", path: "two.ts", linesAdded: 3, linesRemoved: 1 },
      ],
      [{ id: "d", action: "keep" }],
    );
    const out = render(<FileReviewRecord fileReviewSet={set} />).lastFrame() ?? "";
    expect(out).toContain("+12"); // aggregate 9+3
    expect(out).toContain("+9"); // per-file
    expect(out).toContain("+3"); // per-file
  });

  it("renders no stat when the set carries no counts", () => {
    expect(
      render(<FileReviewRecord fileReviewSet={reviewSet([{ id: "a", path: "one.ts" }])} />).lastFrame() ?? "",
    ).not.toContain("+");
  });
});

// --- FileDiffBody ---------------------------------------------------------

/**
 * Polls the rendered frame until it contains `needle`, then returns. Replaces a
 * fixed sleep: an artifact fetch resolves on its own microtask schedule (and a
 * truncated side chains a second download-url fetch), so any single delay raced
 * green locally but timed out under CI load. Polling waits exactly as long as
 * the render needs and no longer, and fails with the actual frame on timeout.
 */
async function waitForFrame(
  lastFrame: () => string | undefined,
  needle: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((lastFrame() ?? "").includes(needle)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForFrame timed out after ${timeoutMs}ms waiting for ${JSON.stringify(
          needle,
        )}; last frame was ${JSON.stringify(lastFrame() ?? "")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function inlineSide(text: string): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value: text } });
}

function offloadedSide(storageKey: string, contentHash = "h"): FileContent {
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, { storageKey, contentHash }),
    },
  });
}

function changeWith(opts: {
  id: string;
  kind?: FileChangeKind;
  before?: FileContent;
  after?: FileContent;
}) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathAfter: "file.ts",
    pathBefore: "file.ts",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    fileDigest: `fd-${opts.id}`,
    before: opts.before,
    after: opts.after,
  });
}

describe("FileDiffBody", () => {
  it("renders +/- lines for an inline whole-file diff (computeDiff parity)", () => {
    const change = changeWith({
      id: "m",
      before: inlineSide("keep\nold\ntail\n"),
      after: inlineSide("keep\nnew\ntail\n"),
    });
    const out = renderWithClient(<FileDiffBody change={change} />).lastFrame() ?? "";
    expect(out).toContain("-old"); // removed, red
    expect(out).toContain("+new"); // added, green
    expect(out).toContain("keep"); // context retained
  });

  it("shows 'Binary file changed.' for a binary side", () => {
    const change = create(CapturedFileChangeSchema, {
      id: "bin",
      pathAfter: "logo.png",
      pathBefore: "logo.png",
      kind: FileChangeKind.BINARY_CHANGE,
      before: create(FileContentSchema, { isBinary: true }),
      after: create(FileContentSchema, { isBinary: true }),
    });
    const out = renderWithClient(<FileDiffBody change={change} />).lastFrame() ?? "";
    expect(out).toContain("Binary file changed.");
  });

  it("labels a genuinely empty new file (CREATE with no content)", () => {
    const change = changeWith({ id: "new", kind: FileChangeKind.ADD, after: inlineSide("") });
    const out = renderWithClient(<FileDiffBody change={change} />).lastFrame() ?? "";
    expect(out).toContain("Empty new file.");
  });

  it("falls back to 'No preview available.' for a MODIFY with no renderable diff", () => {
    const change = changeWith({ id: "np" }); // no before/after content
    const out = renderWithClient(<FileDiffBody change={change} />).lastFrame() ?? "";
    expect(out).toContain("No preview available.");
  });

  it("shows a loading notice while an offloaded side is in flight", () => {
    const change = changeWith({ id: "load", after: offloadedSide("artifacts/run_1/after") });
    const client = fakeClient({
      run: { getArtifactContent: () => new Promise(() => {}) },
    });
    const out = renderWithClient(<FileDiffBody change={change} />, client).lastFrame() ?? "";
    expect(out).toContain("Loading diff");
  });

  it("reports a server-truncated offloaded side as un-diffable inline", async () => {
    const change = changeWith({ id: "trunc", after: offloadedSide("artifacts/run_1/after") });
    const client = fakeClient({
      run: {
        getArtifactContent: async () => ({
          content: new TextEncoder().encode("way too big"),
          contentType: "text/plain",
          truncated: true,
        }),
        // A truncated side activates useArtifactDownloadUrl (the notice offers a
        // full-file download). Stub it so the fetch resolves instead of throwing
        // on an undefined method — an unstubbed throw unmounts the ink tree and
        // blanks the frame, which raced green locally but failed under CI load.
        getArtifactDownloadUrl: async () => ({ downloadUrl: "https://example.test/full" }),
      },
    });
    const { lastFrame } = renderWithClient(<FileDiffBody change={change} />, client);
    await waitForFrame(lastFrame, "too large to diff inline");
    expect(lastFrame() ?? "").toContain("too large to diff inline");
  });

  it("surfaces a fetch failure as an honest error notice", async () => {
    const change = changeWith({ id: "err", after: offloadedSide("artifacts/run_1/after") });
    const client = fakeClient({
      run: {
        getArtifactContent: async () => {
          throw new Error("boom");
        },
      },
    });
    const { lastFrame } = renderWithClient(<FileDiffBody change={change} />, client);
    await waitForFrame(lastFrame, "Could not load this file's contents.");
    expect(lastFrame() ?? "").toContain("Could not load this file's contents.");
  });

  it("caps an oversized diff and reports the overflow", () => {
    const many = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
    const change = changeWith({ id: "big", before: inlineSide(""), after: inlineSide(`${many}\n`) });
    const out = renderWithClient(<FileDiffBody change={change} />).lastFrame() ?? "";
    expect(out).toMatch(/… \d+ more lines/);
  });
});

describe("FileReviewPrompt — inline diff (master-detail)", () => {
  it("shows only the selected file's diff and follows the selection", async () => {
    const set = reviewSet([
      { id: "a", path: "file.ts" },
      { id: "b", path: "file.ts" },
    ]);
    const capture = create(FileChangeSetSchema, {
      id: "cs-1",
      changes: [
        changeWith({ id: "a", before: inlineSide("alpha\n"), after: inlineSide("ALPHA\n") }),
        changeWith({ id: "b", before: inlineSide("bravo\n"), after: inlineSide("BRAVO\n") }),
      ],
    });
    const { stdin, lastFrame } = renderWithClient(
      <FileReviewPrompt fileReviewSet={set} capture={capture} onSubmit={() => {}} />,
    );
    stdin.write("f");
    await tick();
    const first = lastFrame() ?? "";
    expect(first).toContain("+ALPHA"); // selected file's diff
    expect(first).not.toContain("+BRAVO"); // the other file's diff is not mounted

    stdin.write("\u001B[B"); // down → select the second file
    await tick();
    const second = lastFrame() ?? "";
    expect(second).toContain("+BRAVO");
    expect(second).not.toContain("+ALPHA");
  });
});
