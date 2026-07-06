import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import { FileReviewContext } from "@stigmer/react";
import {
  ToolCallSchema,
  FileContentSchema,
  ToolCallOutputRefSchema,
  AgentMessageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeSetSchema,
  CapturedFileChangeSchema,
  FileDecisionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
  DiffCompleteness,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallItem } from "../components/ToolCallItem.js";
import { ToolCallGroup } from "../components/ToolCallGroup.js";
import { FileReviewPrompt } from "../components/FileReviewPrompt.js";
import { FileReviewRecord } from "../components/FileReviewRecord.js";
import { FileDiffBody } from "../components/FileDiffBody.js";
import { MessageThread } from "../components/MessageThread.js";
import { FileLineStats } from "../components/FileReviewAtoms.js";
import { changeSetLineStats } from "../file-review.js";
import { fakeClient, renderWithClient } from "./test-support.js";

// --- fixtures -------------------------------------------------------------

interface ChangeOpts {
  readonly id: string;
  readonly path: string;
  readonly kind?: FileChangeKind;
  readonly diffComplete?: boolean;
  readonly binary?: boolean;
  readonly blockedReason?: FileReviewBlockReason;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

function makeChange(opts: ChangeOpts) {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathAfter: opts.kind === FileChangeKind.DELETE ? "" : opts.path,
    pathBefore: opts.kind === FileChangeKind.DELETE ? opts.path : "",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    diffComplete: opts.diffComplete ?? true,
    fileDigest: `fd-${opts.id}`,
    blockedReason: opts.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
    linesAdded: opts.linesAdded ?? 0,
    linesRemoved: opts.linesRemoved ?? 0,
    before: opts.binary ? create(FileContentSchema, { isBinary: true }) : undefined,
    after: opts.binary ? create(FileContentSchema, { isBinary: true }) : undefined,
  });
}

interface SetOpts {
  readonly id?: string;
  readonly status: FileChangeSetStatus;
  readonly changes: ReturnType<typeof makeChange>[];
  readonly diffCompleteness?: DiffCompleteness;
  readonly decisions?: {
    readonly scope: FileDecisionScope;
    readonly action: FileDecisionAction;
    readonly fileChangeId?: string;
  }[];
}

function makeSet(opts: SetOpts): FileChangeSet {
  return create(FileChangeSetSchema, {
    id: opts.id ?? "cs-1",
    status: opts.status,
    changes: opts.changes,
    aggregateDigest: "agg-1",
    diffCompleteness: opts.diffCompleteness ?? DiffCompleteness.COMPLETE,
    decisions: (opts.decisions ?? []).map((d) =>
      create(FileDecisionSchema, {
        scope: d.scope,
        action: d.action,
        fileChangeId: d.fileChangeId ?? "",
      }),
    ),
  });
}

function stampedTool(path: string, setId: string): ToolCall {
  return create(ToolCallSchema, {
    id: `tc-${path}`,
    name: "write_file",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: { path },
    fileChangeSetId: setId,
  });
}

function renderRow(toolCall: ToolCall, set: FileChangeSet | null) {
  const changeSetsById = set ? new Map([[set.id, set]]) : new Map();
  return render(
    <FileReviewContext.Provider value={{ changeSetsById }}>
      <ToolCallItem toolCall={toolCall} />
    </FileReviewContext.Provider>,
  );
}

// --- FileReviewPrompt: bulk ----------------------------------------------

describe("FileReviewPrompt — bulk", () => {
  const completeSet = makeSet({
    status: FileChangeSetStatus.AWAITING_REVIEW,
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: [
      makeChange({ id: "a", path: "one.ts" }),
      makeChange({ id: "b", path: "two.ts" }),
    ],
  });

  it("shows the summary and complete-set bulk actions", () => {
    const { lastFrame } = render(
      <FileReviewPrompt changeSet={completeSet} onSubmit={() => {}} />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("2 files awaiting review");
    expect(out).toContain("[a] Approve all");
    expect(out).toContain("[r] Reject all");
    expect(out).toContain("[f] Review files");
  });

  it("approves the whole set with the aggregate digest (no acknowledge)", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <FileReviewPrompt changeSet={completeSet} onSubmit={onSubmit} />,
    );
    stdin.write("a");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("rejects the whole set", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <FileReviewPrompt changeSet={completeSet} onSubmit={onSubmit} />,
    );
    stdin.write("r");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.REJECT, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: false,
    });
  });

  it("labels a binary-only set 'Keep all' and acknowledges on keep", () => {
    const binarySet = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      diffCompleteness: DiffCompleteness.BINARY_SUMMARY_ONLY,
      changes: [
        makeChange({ id: "img", path: "logo.png", kind: FileChangeKind.BINARY_CHANGE, diffComplete: false, binary: true }),
        makeChange({ id: "txt", path: "readme.md" }),
      ],
    });
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt changeSet={binarySet} onSubmit={onSubmit} />,
    );
    expect(lastFrame() ?? "").toContain("[a] Keep all");
    stdin.write("a");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.CHANGE_SET,
      expectedDigest: "agg-1",
      acknowledgeUnreviewable: true,
    });
  });

  it("hides bulk keep for a blocked set (no [a]); reject + review only", () => {
    const blockedSet = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
      changes: [
        makeChange({ id: "s", path: ".env", diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD }),
        makeChange({ id: "ok", path: "app.ts" }),
      ],
    });
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt changeSet={blockedSet} onSubmit={onSubmit} />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain("[a]");
    expect(out).toContain("[r] Reject all");
    expect(out).toContain("[f] Review files");
    stdin.write("a"); // no bulk-approve option → ignored
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// --- FileReviewPrompt: per-file ------------------------------------------

/** Let ink/React flush a state transition between keystrokes. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("FileReviewPrompt — per-file", () => {
  const blockedSet = makeSet({
    status: FileChangeSetStatus.AWAITING_REVIEW,
    diffCompleteness: DiffCompleteness.PARTIAL_BLOCKED,
    changes: [
      makeChange({ id: "ok", path: "app.ts" }),
      makeChange({ id: "s", path: ".env", diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD }),
    ],
  });

  it("enters per-file mode and keeps a reviewable file with its file digest", async () => {
    const onSubmit = vi.fn();
    // Per-file mode mounts FileDiffBody, whose useFileChangeContent reads the
    // Stigmer client — so these tests render under a provider.
    const { stdin, lastFrame } = renderWithClient(
      <FileReviewPrompt changeSet={blockedSet} onSubmit={onSubmit} />,
    );
    stdin.write("f");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("app.ts");
    expect(out).toContain(".env");
    expect(out).toContain("keep"); // hint line
    stdin.write("k"); // keep the selected (first) file
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.FILE,
      fileChangeId: "ok",
      expectedDigest: "fd-ok",
      acknowledgeUnreviewable: false,
    });
  });

  it("refuses to keep an unavailable file but allows discard", async () => {
    const onSubmit = vi.fn();
    const { stdin } = renderWithClient(
      <FileReviewPrompt changeSet={blockedSet} onSubmit={onSubmit} />,
    );
    stdin.write("f");
    await tick();
    stdin.write("\u001B[B"); // down → select the secret file
    await tick();
    stdin.write("k"); // keep refused for unavailable
    expect(onSubmit).not.toHaveBeenCalled();
    stdin.write("d"); // discard allowed
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.REJECT, {
      scope: FileDecisionScope.FILE,
      fileChangeId: "s",
      expectedDigest: "fd-s",
      acknowledgeUnreviewable: false,
    });
  });

  it("keeps a binary file with an acknowledgement", async () => {
    const binarySet = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      diffCompleteness: DiffCompleteness.BINARY_SUMMARY_ONLY,
      changes: [
        makeChange({ id: "img", path: "logo.png", kind: FileChangeKind.BINARY_CHANGE, diffComplete: false, binary: true }),
      ],
    });
    const onSubmit = vi.fn();
    const { stdin } = renderWithClient(
      <FileReviewPrompt changeSet={binarySet} onSubmit={onSubmit} />,
    );
    stdin.write("f");
    await tick();
    stdin.write("k");
    expect(onSubmit).toHaveBeenCalledWith("cs-1", FileDecisionAction.APPROVE, {
      scope: FileDecisionScope.FILE,
      fileChangeId: "img",
      expectedDigest: "fd-img",
      acknowledgeUnreviewable: true,
    });
  });
});

// --- FileReviewPrompt: state ---------------------------------------------

describe("FileReviewPrompt — state", () => {
  const set = makeSet({
    status: FileChangeSetStatus.AWAITING_REVIEW,
    changes: [makeChange({ id: "a", path: "one.ts" })],
  });

  it("shows submitting and ignores input while a decision is in flight", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt
        changeSet={set}
        onSubmit={onSubmit}
        submittingDecisionKeys={new Set(["cs-1"])}
      />,
    );
    expect(lastFrame() ?? "").toContain("Submitting");
    stdin.write("a");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a decision error", () => {
    const { lastFrame } = render(
      <FileReviewPrompt
        changeSet={set}
        onSubmit={() => {}}
        decisionErrors={new Map([["cs-1", new Error("digest mismatch")]])}
      />,
    );
    expect(lastFrame() ?? "").toContain("digest mismatch");
  });

  it("is inert and hints when isActive is false", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <FileReviewPrompt changeSet={set} onSubmit={onSubmit} isActive={false} />,
    );
    stdin.write("a");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("Resolve the pending approval first");
  });
});

// --- Row badges -----------------------------------------------------------

describe("ToolCallItem — file-review badge", () => {
  it("badges a pending set as 'Pending review'", () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [makeChange({ id: "a", path: "notes.md" })],
    });
    const { lastFrame } = renderRow(stampedTool("notes.md", "cs-1"), set);
    expect(lastFrame() ?? "").toContain("Pending review");
  });

  it("badges a kept file as 'Kept' and a discarded one as 'Discarded'", () => {
    const kept = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [makeChange({ id: "a", path: "notes.md" })],
      decisions: [{ scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "a" }],
    });
    expect(renderRow(stampedTool("notes.md", "cs-1"), kept).lastFrame() ?? "").toContain("Kept");

    const discarded = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [makeChange({ id: "a", path: "notes.md" })],
      decisions: [{ scope: FileDecisionScope.FILE, action: FileDecisionAction.REJECT, fileChangeId: "a" }],
    });
    expect(renderRow(stampedTool("notes.md", "cs-1"), discarded).lastFrame() ?? "").toContain("Discarded");
  });

  it("badges a failed set as 'Review failed'", () => {
    const failed = makeSet({
      status: FileChangeSetStatus.FAILED,
      changes: [makeChange({ id: "a", path: "notes.md" })],
    });
    expect(renderRow(stampedTool("notes.md", "cs-1"), failed).lastFrame() ?? "").toContain("Review failed");
  });

  it("shows no badge for an unstamped row", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "write_file",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "notes.md" },
    });
    const out = renderRow(tc, null).lastFrame() ?? "";
    expect(out).not.toContain("Pending review");
    expect(out).not.toContain("Kept");
  });

  it("shows no badge when the set is still CAPTURING", () => {
    const capturing = makeSet({
      status: FileChangeSetStatus.CAPTURING,
      changes: [makeChange({ id: "a", path: "notes.md" })],
    });
    const out = renderRow(stampedTool("notes.md", "cs-1"), capturing).lastFrame() ?? "";
    expect(out).not.toContain("Pending review");
    expect(out).not.toContain("Kept");
  });

  it("shows no badge when the stamped path is absent from the set", () => {
    const decided = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [makeChange({ id: "a", path: "other.md" })],
      decisions: [{ scope: FileDecisionScope.CHANGE_SET, action: FileDecisionAction.APPROVE }],
    });
    const out = renderRow(stampedTool("notes.md", "cs-1"), decided).lastFrame() ?? "";
    expect(out).not.toContain("Kept");
  });
});

// --- Collapsed-group aggregate cue ---------------------------------------

describe("ToolCallGroup — aggregate review cue", () => {
  it("surfaces a pending edit on the collapsed summary", () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [makeChange({ id: "a", path: "notes.md" })],
    });
    const { lastFrame } = render(
      <FileReviewContext.Provider value={{ changeSetsById: new Map([[set.id, set]]) }}>
        <ToolCallGroup toolCalls={[stampedTool("notes.md", "cs-1")]} />
      </FileReviewContext.Provider>,
    );
    expect(lastFrame() ?? "").toContain("1 pending review");
  });

  it("shows no cue when no row is stamped", () => {
    const tc = create(ToolCallSchema, { id: "t", name: "read_file", status: ToolCallStatus.TOOL_CALL_COMPLETED });
    const { lastFrame } = render(<ToolCallGroup toolCalls={[tc]} />);
    const out = lastFrame() ?? "";
    expect(out).not.toContain("pending review");
  });
});

// --- Settled record -------------------------------------------------------

describe("FileReviewRecord", () => {
  it("summarizes kept/discarded and lists files", () => {
    const set = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [
        makeChange({ id: "a", path: "one.ts" }),
        makeChange({ id: "b", path: "two.ts" }),
        makeChange({ id: "c", path: "three.ts" }),
      ],
      decisions: [
        { scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "a" },
        { scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "b" },
        { scope: FileDecisionScope.FILE, action: FileDecisionAction.REJECT, fileChangeId: "c" },
      ],
    });
    const { lastFrame } = render(<FileReviewRecord fileChangeSet={set} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("2 kept · 1 discarded");
    expect(out).toContain("one.ts");
    expect(out).toContain("(discarded)");
  });

  it("reports a failed reconcile", () => {
    const set = makeSet({
      status: FileChangeSetStatus.FAILED,
      changes: [makeChange({ id: "a", path: "one.ts" })],
    });
    expect(render(<FileReviewRecord fileChangeSet={set} />).lastFrame() ?? "").toContain("review failed");
  });
});

// --- MessageThread integration -------------------------------------------

describe("MessageThread — file-review integration", () => {
  function execWithStampedEdit(status: FileChangeSetStatus, decided: boolean) {
    const set = makeSet({
      id: "cs-1",
      status,
      changes: [makeChange({ id: "a", path: "notes.md" })],
      decisions: decided
        ? [{ scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "a" }]
        : [],
    });
    const aiMsg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "Editing notes",
      toolCalls: [stampedTool("notes.md", "cs-1")],
    });
    return create(AgentExecutionSchema, {
      metadata: { id: "aex-1" },
      status: {
        phase: undefined,
        messages: [aiMsg],
        fileChangeSets: [set],
      },
    });
  }

  it("badges a settled row and appends a settled record for a completed execution", () => {
    const exec = execWithStampedEdit(FileChangeSetStatus.RECONCILED, true);
    const { lastFrame } = render(
      <MessageThread executions={[exec]} showFileReviewRecords expandToolCalls />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Kept"); // per-row badge
    expect(out).toContain("File review — 1 kept"); // settled record
  });

  it("does not render a settled record for an AWAITING set (that is the prompt's job)", () => {
    const exec = execWithStampedEdit(FileChangeSetStatus.AWAITING_REVIEW, false);
    const { lastFrame } = render(
      <MessageThread executions={[]} activeStreamExecution={exec} showFileReviewRecords expandToolCalls />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Pending review"); // the row still badges
    expect(out).not.toContain("File review —"); // but no settled record
  });
});

// --- FileLineStats (shared atom) -----------------------------------------

describe("FileLineStats", () => {
  it("renders nothing when both counts are zero (never +0 -0)", () => {
    const { lastFrame } = render(<FileLineStats linesAdded={0} linesRemoved={0} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });

  it("renders +N -M when counts exist", () => {
    const { lastFrame } = render(<FileLineStats linesAdded={7} linesRemoved={3} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("+7");
    expect(out).toContain("-3");
  });

  it("renders a one-sided stat (added only) without hiding it", () => {
    const { lastFrame } = render(<FileLineStats linesAdded={5} linesRemoved={0} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("+5");
    expect(out).toContain("-0"); // both sides always shown once any count exists
  });
});

// --- changeSetLineStats (pure helper) ------------------------------------

describe("changeSetLineStats", () => {
  it("sums per-file counts across the set", () => {
    const set = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [
        makeChange({ id: "a", path: "one.ts", linesAdded: 10, linesRemoved: 2 }),
        makeChange({ id: "b", path: "two.ts", linesAdded: 5, linesRemoved: 3 }),
      ],
    });
    expect(changeSetLineStats(set)).toEqual({ linesAdded: 15, linesRemoved: 5 });
  });

  it("treats an uncountable (binary/withheld) file as a zero contributor — honest understatement", () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [
        makeChange({ id: "txt", path: "app.ts", linesAdded: 8, linesRemoved: 1 }),
        makeChange({ id: "img", path: "logo.png", kind: FileChangeKind.BINARY_CHANGE, binary: true }),
      ],
    });
    expect(changeSetLineStats(set)).toEqual({ linesAdded: 8, linesRemoved: 1 });
  });

  it("is zero for a set whose files carry no counts (stat then hidden by the atom)", () => {
    const set = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [makeChange({ id: "a", path: "one.ts" })],
    });
    expect(changeSetLineStats(set)).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });
});

// --- Line stats on the review surfaces -----------------------------------

describe("FileReviewPrompt — line stats", () => {
  it("shows the set aggregate +N -M on the header", () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [
        makeChange({ id: "a", path: "one.ts", linesAdded: 12, linesRemoved: 3 }),
        makeChange({ id: "b", path: "two.ts", linesAdded: 4, linesRemoved: 1 }),
      ],
    });
    const out = render(<FileReviewPrompt changeSet={set} onSubmit={() => {}} />).lastFrame() ?? "";
    expect(out).toContain("2 files awaiting review");
    expect(out).toContain("+16");
    expect(out).toContain("-4");
  });

  it("hides the header aggregate when no file has counts (never +0 -0)", () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [makeChange({ id: "a", path: "one.ts" })],
    });
    const out = render(<FileReviewPrompt changeSet={set} onSubmit={() => {}} />).lastFrame() ?? "";
    expect(out).not.toContain("+");
  });

  it("shows per-file +N -M in per-file mode", async () => {
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [
        makeChange({ id: "a", path: "one.ts", linesAdded: 10, linesRemoved: 2 }),
        makeChange({ id: "b", path: "two.ts", linesAdded: 4, linesRemoved: 0 }),
      ],
    });
    const { stdin, lastFrame } = renderWithClient(
      <FileReviewPrompt changeSet={set} onSubmit={() => {}} />,
    );
    stdin.write("f");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("+10");
    expect(out).toContain("+4");
  });
});

describe("FileReviewRecord — line stats", () => {
  it("shows the set aggregate and per-file +N -M", () => {
    const set = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [
        makeChange({ id: "a", path: "one.ts", linesAdded: 9, linesRemoved: 2 }),
        makeChange({ id: "b", path: "two.ts", linesAdded: 3, linesRemoved: 1 }),
      ],
      decisions: [
        { scope: FileDecisionScope.CHANGE_SET, action: FileDecisionAction.APPROVE },
      ],
    });
    const out = render(<FileReviewRecord fileChangeSet={set} />).lastFrame() ?? "";
    expect(out).toContain("+12"); // aggregate 9+3
    expect(out).toContain("+9"); // per-file
    expect(out).toContain("+3"); // per-file
  });

  it("renders no stat when the set carries no counts", () => {
    const set = makeSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [makeChange({ id: "a", path: "one.ts" })],
    });
    expect(render(<FileReviewRecord fileChangeSet={set} />).lastFrame() ?? "").not.toContain("+");
  });
});

// --- FileDiffBody ---------------------------------------------------------

/** Let an async artifact fetch resolve and the component re-render. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

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
    const change = changeWith({ id: "load", after: offloadedSide("artifacts/aex-1/after") });
    const client = fakeClient({
      agentExecution: { getArtifactContent: () => new Promise(() => {}) },
    });
    const out = renderWithClient(<FileDiffBody change={change} />, client).lastFrame() ?? "";
    expect(out).toContain("Loading diff");
  });

  it("reports a server-truncated offloaded side as un-diffable inline", async () => {
    const change = changeWith({ id: "trunc", after: offloadedSide("artifacts/aex-1/after") });
    const client = fakeClient({
      agentExecution: {
        getArtifactContent: async () => ({
          content: new TextEncoder().encode("way too big"),
          contentType: "text/plain",
          truncated: true,
        }),
      },
    });
    const { lastFrame } = renderWithClient(<FileDiffBody change={change} />, client);
    await settle();
    expect(lastFrame() ?? "").toContain("too large to diff inline");
  });

  it("surfaces a fetch failure as an honest error notice", async () => {
    const change = changeWith({ id: "err", after: offloadedSide("artifacts/aex-1/after") });
    const client = fakeClient({
      agentExecution: {
        getArtifactContent: async () => {
          throw new Error("boom");
        },
      },
    });
    const { lastFrame } = renderWithClient(<FileDiffBody change={change} />, client);
    await settle();
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
    const set = makeSet({
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [
        changeWith({ id: "a", before: inlineSide("alpha\n"), after: inlineSide("ALPHA\n") }),
        changeWith({ id: "b", before: inlineSide("bravo\n"), after: inlineSide("BRAVO\n") }),
      ],
    });
    const { stdin, lastFrame } = renderWithClient(
      <FileReviewPrompt changeSet={set} onSubmit={() => {}} />,
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
