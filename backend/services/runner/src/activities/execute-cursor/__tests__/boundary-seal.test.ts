/**
 * Pins Cursor's boundary predicate (`../boundary-rows.ts`
 * `boundaryMayStillRewrite`), the capability the session event emitter
 * reads so it never writes a row this harness's turn boundary will reopen,
 * hide or settle differently, and runs the emitter with it: a hook-blocked
 * call writes nothing before the boundary, nor does the narration after it,
 * nor its preview; the reopened gate is written as an ask.
 */

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { RunStatusSchema, type RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { AppendSessionEventsResponseSchema, type SessionEventPreview } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { SessionEventEmitter } from "../../../harness/events/emitter.js";
import { boundaryMayStillRewrite } from "../boundary-rows.js";
import { ToolCallSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const RUN = "run_01jz8k3q9w4e5r6t7y8u9i0o1p";
const AI = MessageType.MESSAGE_AI;
const S = ToolCallStatus;

type RowInit = MessageInitShape<typeof ToolCallSchema>;

function row(id: string, init: RowInit = {}): RowInit {
  return { id, name: "read", status: S.TOOL_CALL_COMPLETED, result: "ok", ...init };
}

function status(init: MessageInitShape<typeof RunStatusSchema>): RunStatus {
  return create(RunStatusSchema, init);
}

function logDouble() {
  const events: SessionEvent[] = [];
  const previews: SessionEventPreview[] = [];
  const client = {
    appendSessionEvents: vi.fn(async (_run: string, batch: readonly SessionEvent[], sent: readonly SessionEventPreview[]) => {
      events.push(...batch);
      previews.push(...sent);
      return create(AppendSessionEventsResponseSchema);
    }),
    listRunSessionEvents: vi.fn(async () => [...events]),
  };
  return { events, previews, client };
}

function emitter(log: ReturnType<typeof logDouble>): SessionEventEmitter {
  return new SessionEventEmitter({
    client: log.client,
    runId: RUN,
    credential: async () => undefined,
    delay: async () => {},
    boundaryRewritesRow: boundaryMayStillRewrite,
  });
}

function ids(log: ReturnType<typeof logDouble>): string[] {
  return log.events.map((e) => (e.event.case === undefined ? "" : e.event.value.id.slice(RUN.length + 1)));
}

describe("the session events of a Cursor turn", () => {

  it("writes no tool use or result for a hook-blocked call before the boundary, nor the narration after it, nor its preview", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [
        { type: AI, content: "Reading the secret plan.", toolCalls: [row("blocked", { status: S.TOOL_CALL_FAILED, result: "", error: "Tool call was blocked by a hook" })] },
        { type: AI, content: "The read was blocked, so I will" },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    e.observe({ kind: "text_delta", runId: "seg-2", text: "The read was blocked" }, { messageIndex: 1 });
    await e.flush(st, { final: false });
    expect(ids(log), "only the message before the blocked call").toEqual(["root.m0"]);
    expect(log.previews, "the narration after the block is never previewed").toEqual([]);

    // The boundary reopens the call as the turn's gate and blanks the narration.
    const blocked = st.messages[0]!.toolCalls[0]!;
    blocked.status = S.TOOL_CALL_WAITING_APPROVAL;
    blocked.error = "";
    blocked.requiresApproval = true;
    blocked.approvalMessage = "Read secret-plan.md";
    st.messages[1]!.content = "";
    e.observe({ kind: "text_delta", runId: "seg-2", text: " retry" }, { messageIndex: 1 });
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "blocked", "blocked.ask"]);
    const use = log.events[1]!.event;
    expect(use.case === "agentToolUse" && use.value.evaluatedPermission).toBe("ask");
    expect(log.previews).toEqual([]);
  });

  it("a settled read writes at once; a gated call with no change of its own waits for the boundary", async () => {
    const log = logDouble();
    const e = emitter(log);
    const st = status({
      messages: [
        { type: AI, content: "Two steps.", toolCalls: [row("read-1"), row("edit-1", { name: "edit", args: { path: "a.md" }, result: "ok" })] },
      ],
    });
    await e.begin({ sessionId: "ses_1", resumed: false, status: create(RunStatusSchema) });
    await e.flush(st, { final: false });
    expect(ids(log)).toEqual(["root.m0", "read-1"]);
    await e.flush(st, { final: true });
    expect(ids(log)).toEqual(["root.m0", "read-1", "edit-1", "read-1.r", "edit-1.r"]);
  });

  it("the boundary's predicate covers every row it may still rewrite, and no other", () => {
    const rows: Array<[RowInit, boolean]> = [
      [row("x", { status: S.TOOL_CALL_RUNNING }), true],
      [row("x", { status: S.TOOL_CALL_FAILED, error: "blocked by a hook" }), true],
      [row("x", { name: "shell", args: { command: "ls" }, result: "" }), true],
      [row("x", { name: "edit", args: { path: "a.md" } }), true],
      [row("x", { name: "search", mcpServerSlug: "docs", result: "" }), true],
      [row("x"), false],
      [row("x", { name: "shell", args: { command: "ls" }, result: "src\n" }), false],
      [row("x", { status: S.TOOL_CALL_FAILED, error: "ENOENT" }), false],
    ];
    for (const [init, expected] of rows) {
      expect(boundaryMayStillRewrite(create(ToolCallSchema, init)), JSON.stringify(init)).toBe(expected);
    }
  });
});

