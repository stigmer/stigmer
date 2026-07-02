/**
 * Positioning tests for file-review decision bars: each change set's
 * `file-review-request` item must render inside its own execution's segment,
 * immediately after the set's LAST stamped edit row
 * (`ToolCall.file_change_set_id`), with a segment-tail backstop for sets that
 * have no stamped row (shell-made changes, legacy transcripts). Interactivity
 * gates on each execution's OWN phase — a historical execution's set is always
 * read-only, and only a live AWAITING_REVIEW set is actionable.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  FileContentSchema,
  ToolCallSchema,
  type AgentMessage,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileChangeSetStatus,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A completed edit tool call, optionally stamped with its change set id. */
function editCall(id: string, path: string, fileChangeSetId = ""): ToolCall {
  return create(ToolCallSchema, {
    id,
    name: "edit",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: { path, old_string: "a", new_string: "b" },
    fileChangeSetId,
  });
}

function aiMessage(content: string, toolCalls: ToolCall[] = []): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
    toolCalls,
  });
}

function changeSet(id: string, paths: string[], status = FileChangeSetStatus.AWAITING_REVIEW): FileChangeSet {
  return create(FileChangeSetSchema, {
    id,
    status,
    aggregateDigest: "agg",
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: paths.map((path) =>
      create(CapturedFileChangeSchema, {
        id: `${id}:${path}`,
        pathBefore: path,
        pathAfter: path,
        kind: FileChangeKind.MODIFY,
        before: create(FileContentSchema, { body: { case: "inline", value: "a\n" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "b\n" } }),
        fileDigest: `d-${path}`,
        diffComplete: true,
      }),
    ),
  });
}

function execution(opts: {
  id: string;
  phase: ExecutionPhase;
  messages: AgentMessage[];
  changeSets?: FileChangeSet[];
}): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: opts.id }),
    spec: create(AgentExecutionSpecSchema, { message: "go" }),
    status: create(AgentExecutionStatusSchema, {
      phase: opts.phase,
      messages: opts.messages,
      fileChangeSets: opts.changeSets ?? [],
    }),
  });
}

/** buildThreadItems with file review enabled (positional args, approvals off). */
function build(executions: AgentExecution[]): ThreadItem[] {
  return buildThreadItems(
    executions,
    null,
    null,
    false,
    undefined,
    undefined,
    false,
    false,
    true,
  );
}

function kinds(items: ThreadItem[]): string[] {
  return items.map((i) => i.kind);
}

function reviewIndex(items: ThreadItem[], setId: string): number {
  return items.findIndex(
    (i) => i.kind === "file-review-request" && i.fileChangeSet.id === setId,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildThreadItems — file-review decision bar positioning", () => {
  it("places the decision bar immediately after the set's LAST stamped row, not at the tail", () => {
    const setId = "aex-1:0";
    const exec = execution({
      id: "aex-1",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        aiMessage("Let me edit.", [editCall("tc-1", "notes.md", setId)]),
        aiMessage("Running tests.", [
          create(ToolCallSchema, { id: "tc-shell", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { command: "npm test" } }),
        ]),
        aiMessage("One more edit.", [editCall("tc-2", "README.md", setId)]),
        aiMessage("All done, summary follows."),
      ],
      changeSets: [changeSet(setId, ["notes.md", "README.md"])],
    });

    const items = build([exec]);
    const barIdx = reviewIndex(items, setId);
    expect(barIdx).toBeGreaterThan(-1);

    // The item right before the bar is the tool group carrying the LAST
    // stamped row (tc-2); the closing narration comes after.
    const before = items[barIdx - 1];
    expect(before.kind).toBe("tool-group");
    expect(
      before.kind === "tool-group" && before.toolCalls.some((tc) => tc.id === "tc-2"),
    ).toBe(true);
    const closing = items.findIndex(
      (i) => i.kind === "message" && i.message.content === "All done, summary follows.",
    );
    expect(barIdx).toBeLessThan(closing);
  });

  it("falls back to the segment tail for a set with no stamped row (shell-made changes)", () => {
    const setId = "aex-1:0";
    const exec = execution({
      id: "aex-1",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        aiMessage("Shell only.", [
          create(ToolCallSchema, { id: "tc-shell", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED, args: { command: "echo x > f.txt" } }),
        ]),
      ],
      changeSets: [changeSet(setId, ["f.txt"])],
    });

    const items = build([exec]);
    const barIdx = reviewIndex(items, setId);
    expect(barIdx).toBe(items.length - 1); // never invisible — tail backstop
  });

  it("keeps every turn's bar in its own segment across multiple executions, read-only for historical ones", () => {
    const historical = execution({
      id: "aex-1",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages: [aiMessage("Turn one edit.", [editCall("tc-old", "a.ts", "aex-1:0")])],
      changeSets: [changeSet("aex-1:0", ["a.ts"], FileChangeSetStatus.RECONCILED)],
    });
    const live = execution({
      id: "aex-2",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [aiMessage("Turn two edit.", [editCall("tc-new", "b.ts", "aex-2:0")])],
      changeSets: [changeSet("aex-2:0", ["b.ts"])],
    });

    const items = build([historical, live]);
    const oldBar = reviewIndex(items, "aex-1:0");
    const newBar = reviewIndex(items, "aex-2:0");

    // The historical bar sits inside the FIRST execution's segment — before
    // the second execution's opening message — not at the thread tail.
    const secondTurnStart = items.findIndex(
      (i) => i.kind === "message" && i.message.content === "Turn two edit.",
    );
    expect(oldBar).toBeGreaterThan(-1);
    expect(oldBar).toBeLessThan(secondTurnStart);
    expect(newBar).toBeGreaterThan(secondTurnStart);

    // Interactivity gates on each execution's OWN phase.
    const oldItem = items[oldBar];
    const newItem = items[newBar];
    expect(oldItem.kind === "file-review-request" && oldItem.interactive).toBe(false);
    expect(newItem.kind === "file-review-request" && newItem.interactive).toBe(true);
  });

  it("anchors each of a multi-turn execution's sets to its own rows", () => {
    // One execution, two turns (a resume): each turn's set anchors after ITS
    // last stamped row, in transcript order.
    const exec = execution({
      id: "aex-1",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        aiMessage("Turn one.", [editCall("tc-t1", "a.ts", "aex-1:0")]),
        aiMessage("Turn two.", [editCall("tc-t2", "b.ts", "aex-1:1")]),
      ],
      changeSets: [
        changeSet("aex-1:0", ["a.ts"], FileChangeSetStatus.RECONCILED),
        changeSet("aex-1:1", ["b.ts"]),
      ],
    });

    const items = build([exec]);
    const bar0 = reviewIndex(items, "aex-1:0");
    const bar1 = reviewIndex(items, "aex-1:1");
    expect(bar0).toBeGreaterThan(-1);
    expect(bar1).toBeGreaterThan(bar0);

    // Each bar directly follows the tool group carrying its own turn's row.
    const before0 = items[bar0 - 1];
    const before1 = items[bar1 - 1];
    expect(
      before0.kind === "tool-group" && before0.toolCalls.some((tc) => tc.id === "tc-t1"),
    ).toBe(true);
    expect(
      before1.kind === "tool-group" && before1.toolCalls.some((tc) => tc.id === "tc-t2"),
    ).toBe(true);
  });

  it("skips a CAPTURING set (no changes yet) and emits nothing without onFileDecisionSubmit", () => {
    const exec = execution({
      id: "aex-1",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [aiMessage("Working.", [editCall("tc-1", "a.ts", "aex-1:0")])],
      changeSets: [changeSet("aex-1:0", [], FileChangeSetStatus.CAPTURING)],
    });

    // An empty-changes set never renders…
    expect(kinds(build([exec]))).not.toContain("file-review-request");

    // …and with file review disabled (last positional arg false) none render
    // regardless of change sets.
    const withChanges = execution({
      id: "aex-2",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [aiMessage("Edit.", [editCall("tc-2", "b.ts", "aex-2:0")])],
      changeSets: [changeSet("aex-2:0", ["b.ts"])],
    });
    const disabled = buildThreadItems(
      [withChanges],
      null,
      null,
      false,
      undefined,
      undefined,
      false,
      false,
      false,
    );
    expect(kinds(disabled)).not.toContain("file-review-request");
  });

  it("renders a legacy hidden row as absent while its set still surfaces at the segment tail", () => {
    // A pre-stamping session: the flowed edit row was collapsed to the hidden
    // SKIPPED shape (no stamp), and the set has no anchor. The hidden row must
    // not resurface; the set falls back to the tail.
    const setId = "aex-legacy:0";
    const hidden = create(ToolCallSchema, {
      id: "tc-hidden",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
    });
    const exec = execution({
      id: "aex-legacy",
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [aiMessage("Edited.", [hidden])],
      changeSets: [changeSet(setId, ["a.ts"])],
    });

    const items = build([exec]);
    // The hidden row's message emits no tool group (its only call is collapsed).
    expect(kinds(items)).not.toContain("tool-group");
    // The set still surfaces, at the tail.
    expect(reviewIndex(items, setId)).toBe(items.length - 1);
  });
});
