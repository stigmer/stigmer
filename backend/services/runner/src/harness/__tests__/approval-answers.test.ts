/**
 * Pins the runtime's one door for a person's answers (`approval-answers.ts`):
 *
 *  - the map from the log onto the seeded rows: allow is APPROVE, deny is
 *    REJECT with its reason, the call a grant was given on is APPROVE_ALL;
 *    the decisions are the root rows still WAITING_APPROVAL, in transcript
 *    order, each by its tool use id (`events/ids.ts`, the id the ask was
 *    written under), so an answer to another run or another call never
 *    lands; beside them every answer, grant (with its lease) and ask
 *    (policy source, hook, content digest) of the run, by tool use id;
 *  - the seed's copy: every row, root and sub-agent, carries the log's
 *    answer to its call and nothing else, whatever it was fetched with;
 *  - the read: one typed read of the run's answers, grants and asks on
 *    every reinvocation, rows waiting or not, and a failed read fails the
 *    turn's start.
 *
 * The test kits drive the same map over their modelled logs, and the
 * hermetic goldens prove the whole round trip on both engines.
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SubAgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/subagent_pb";
import { ApprovalAction, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import {
  APPROVAL_ANSWER_EVENT_TYPES,
  approvalAnswersOf,
  copyAnswersOntoRows,
  readApprovalAnswers,
} from "../approval-answers.js";
import { toolUseEventId } from "../events/ids.js";

const RUN = "run_01answers";

function waiting(id: string) {
  return create(ToolCallSchema, { id, name: "Shell", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL });
}

/** Every row shape the door must answer or pass over. */
function status() {
  return create(RunStatusSchema, {
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [waiting("call_allow"), waiting("call_deny"), waiting("call_unanswered")],
      }),
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, { id: "call_done", name: "Read", status: ToolCallStatus.TOOL_CALL_COMPLETED }),
          waiting("call_granted"),
          waiting("call/needs-hash"),
          waiting("call_bare_deny"),
        ],
      }),
    ],
    subAgentRuns: [
      create(SubAgentRunSchema, {
        messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [waiting("call_sub")] })],
      }),
    ],
  });
}

function confirmation(callId: string, result: string, denyMessage = "", runId = RUN): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: { case: "userToolConfirmation", value: { id: `sevt_tc_${callId}`, result, toolUseId: toolUseEventId(runId, callId), denyMessage } },
  });
}

function grant(callId: string, lease: { category?: string; server?: string; hook?: string; tool?: string } = { category: "shell" }): SessionEvent {
  return create(SessionEventSchema, {
    runId: RUN,
    event: {
      case: "stigmerPermissionGrant",
      value: { id: `sevt_pg_${callId}`, toolUseId: toolUseEventId(RUN, callId), scope: "turn", lease },
    },
  });
}

function asked(callId: string, policySource: string, contentDigest = "", policyHook = ""): SessionEvent {
  const toolUseId = toolUseEventId(RUN, callId);
  return create(SessionEventSchema, {
    runId: RUN,
    event: { case: "stigmerPermissionAsked", value: { id: `${toolUseId}.ask`, toolUseId, policySource, policyHook, contentDigest } },
  });
}

const LOG: SessionEvent[] = [
  confirmation("call_granted", "allow"),
  grant("call_granted"),
  confirmation("call_deny", "deny", "use make clean instead"),
  confirmation("call_allow", "allow"),
  confirmation("call/needs-hash", "allow"),
  confirmation("call_bare_deny", "deny"),
  confirmation("call_done", "allow"),
  confirmation("call_sub", "allow"),
  confirmation("call_unanswered", "allow", "", "run_other"),
];

describe("approvalAnswersOf", () => {
  it("answers every WAITING root row from the log, in transcript order: allow, deny with its reason, and the granted call", () => {
    const answers = approvalAnswersOf(RUN, status(), LOG);
    expect([...answers.decisions.entries()]).toEqual([
      ["call_allow", ApprovalAction.APPROVE],
      ["call_deny", ApprovalAction.REJECT],
      ["call_granted", ApprovalAction.APPROVE_ALL],
      ["call/needs-hash", ApprovalAction.APPROVE],
      ["call_bare_deny", ApprovalAction.REJECT],
    ]);
    expect([...answers.denyMessages.entries()], "only a deny that carries a reason has one").toEqual([
      ["call_deny", "use make clean instead"],
    ]);
  });

  it("passes over an unanswered row, a settled row, a sub-agent's row and another run's answer", () => {
    const { decisions } = approvalAnswersOf(RUN, status(), LOG);
    expect(decisions.has("call_unanswered"), "its only answer names another run's tool use").toBe(false);
    expect(decisions.has("call_done"), "already run; its answer is history").toBe(false);
    expect(decisions.has("call_sub"), "sub-agent transcripts are not the rows a turn resumes by").toBe(false);
  });

  it("keeps the first answer to a call, and ignores a result it does not know", () => {
    const { decisions } = approvalAnswersOf(RUN, status(), [
      confirmation("call_allow", "allow"),
      confirmation("call_allow", "deny"),
      confirmation("call_deny", "maybe"),
    ]);
    expect([...decisions.entries()]).toEqual([["call_allow", ApprovalAction.APPROVE]]);
  });

  it("answers nothing from an empty log or a fresh status", () => {
    expect(approvalAnswersOf(RUN, status(), []).decisions.size).toBe(0);
    expect(approvalAnswersOf(RUN, create(RunStatusSchema, {}), LOG).decisions.size).toBe(0);
  });
});

describe("the run's answers, grants and asks", () => {
  it("keeps every answer of the run by tool use id, the first to a call standing, settled and sub-agent calls included", () => {
    const { answers } = approvalAnswersOf(RUN, status(), [...LOG, confirmation("call_allow", "deny", "too late")]);
    expect(answers.get(toolUseEventId(RUN, "call_done"))).toEqual({ result: "allow", denyMessage: "" });
    expect(answers.get(toolUseEventId(RUN, "call_sub"))).toEqual({ result: "allow", denyMessage: "" });
    expect(answers.get(toolUseEventId(RUN, "call_allow"))).toEqual({ result: "allow", denyMessage: "" });
    expect(answers.get(toolUseEventId(RUN, "call_deny"))).toEqual({ result: "deny", denyMessage: "use make clean instead" });
  });

  it("keeps each grant's lease, a hook's (the agent's own, with an empty hook) apart from a server's or a category's", () => {
    const { grants } = approvalAnswersOf(RUN, status(), [
      grant("call_granted"),
      grant("call_allow", { server: "github" }),
      grant("call_sub", { hook: "", tool: "execute" }),
      grant("call_granted", { server: "ignored" }),
    ]);
    expect([...grants.entries()]).toEqual([
      [toolUseEventId(RUN, "call_granted"), { category: "shell", server: "", hook: undefined, tool: "" }],
      [toolUseEventId(RUN, "call_allow"), { category: "", server: "github", hook: undefined, tool: "" }],
      [toolUseEventId(RUN, "call_sub"), { category: "", server: "", hook: "", tool: "execute" }],
    ]);
  });

  it("keeps what each call was asked under: its rule's word, its hook and its content digest", () => {
    const { asks } = approvalAnswersOf(RUN, status(), [
      asked("call_allow", "builtin_category", "sha256:abc"),
      asked("call_deny", "hook", "args:def", "safety"),
      asked("call_allow", "hook"),
    ]);
    expect([...asks.entries()]).toEqual([
      [toolUseEventId(RUN, "call_allow"), { policySource: "builtin_category", policyHook: "", contentDigest: "sha256:abc" }],
      [toolUseEventId(RUN, "call_deny"), { policySource: "hook", policyHook: "safety", contentDigest: "args:def" }],
    ]);
  });
});

describe("copyAnswersOntoRows", () => {
  it("puts the log's answer on every row, root and sub-agent, and clears what a row was fetched with", () => {
    const seeded = status();
    const rows = [...seeded.messages, ...seeded.subAgentRuns.flatMap((run) => run.messages)].flatMap((m) => m.toolCalls);
    for (const row of rows) row.approvalAction = ApprovalAction.SKIP;
    copyAnswersOntoRows(RUN, seeded, approvalAnswersOf(RUN, seeded, LOG));
    expect(rows.map((row) => [row.id, row.approvalAction])).toEqual([
      ["call_allow", ApprovalAction.APPROVE],
      ["call_deny", ApprovalAction.REJECT],
      ["call_unanswered", ApprovalAction.UNSPECIFIED],
      ["call_done", ApprovalAction.APPROVE],
      ["call_granted", ApprovalAction.APPROVE_ALL],
      ["call/needs-hash", ApprovalAction.APPROVE],
      ["call_bare_deny", ApprovalAction.REJECT],
      ["call_sub", ApprovalAction.APPROVE],
    ]);
  });
});

describe("readApprovalAnswers", () => {
  it("reads the run's log even when no row waits: closed rows and leases need the answers too", async () => {
    const client = { listRunSessionEvents: vi.fn(async () => LOG) };
    const settled = create(RunStatusSchema, {
      messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [create(ToolCallSchema, { id: "call_granted", status: ToolCallStatus.TOOL_CALL_COMPLETED })] })],
    });
    const answers = await readApprovalAnswers(client, { sessionId: "ses_1", runId: RUN, status: settled });
    expect(client.listRunSessionEvents).toHaveBeenCalledExactlyOnceWith("ses_1", RUN, APPROVAL_ANSWER_EVENT_TYPES);
    expect(answers.decisions.size, "nothing waits, so nothing is decided this turn").toBe(0);
    expect(answers.grants.has(toolUseEventId(RUN, "call_granted")), "the grant still leases").toBe(true);
  });

  it("lists the run's answers, grants and asks by type, once, and maps them onto the seed", async () => {
    const client = { listRunSessionEvents: vi.fn(async () => LOG) };
    const answers = await readApprovalAnswers(client, { sessionId: "ses_1", runId: RUN, status: status() });
    expect(client.listRunSessionEvents).toHaveBeenCalledExactlyOnceWith("ses_1", RUN, APPROVAL_ANSWER_EVENT_TYPES);
    expect(APPROVAL_ANSWER_EVENT_TYPES).toEqual(["user.tool_confirmation", "stigmer.permission.grant", "stigmer.permission.asked"]);
    expect(answers.decisions.get("call_deny")).toBe(ApprovalAction.REJECT);
  });

  it("fails the turn's start when the log cannot be read", async () => {
    const client = { listRunSessionEvents: vi.fn(async () => Promise.reject(new Error("log unreachable"))) };
    await expect(readApprovalAnswers(client, { sessionId: "ses_1", runId: RUN, status: status() })).rejects.toThrow("log unreachable");
  });
});
