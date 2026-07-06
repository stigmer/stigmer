/**
 * Unit tests for the DEEP-AGENT approved-command provenance adapter (DD-28).
 *
 * These pin the two things that differ from the Cursor harness: identity turn
 * scoping (a call whose id is absent from the pre-stream settled snapshot is
 * this-turn's) and same-row consent (the executed shell row carries its own
 * server-authored approval_action). The two regressions the plan calls out are
 * asserted explicitly: a seeded WAITING_APPROVAL -> COMPLETED approved shell IS
 * counted, and a prior turn's settled call is NOT re-evaluated. The DD-28 rule
 * itself is covered by shared/filereview/__tests__/command-provenance.test.ts.
 */

import { describe, it, expect } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { deriveTurnCommandProvenance } from "../command-provenance.js";

function toolCall(overrides: MessageInitShape<typeof ToolCallSchema>): ToolCall {
  return create(ToolCallSchema, {
    id: "call-1",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    ...overrides,
  });
}

function aiMessage(toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls });
}

/** A COMPLETED shell row (the deep-agent shell tool is `execute`). */
function executedShell(id: string, overrides: MessageInitShape<typeof ToolCallSchema> = {}): ToolCall {
  return toolCall({ id, name: "execute", args: { command: "seq 1 5 > out.txt" }, ...overrides });
}

function status(messages: AgentMessage[], subAgents: MessageInitShape<typeof SubAgentExecutionSchema>[] = []) {
  return create(AgentExecutionStatusSchema, {
    messages,
    subAgentExecutions: subAgents.map((sa) => create(SubAgentExecutionSchema, sa)),
  });
}

const NO_SETTLED = new Set<string>();
const NO_SUBAGENTS = new Set<string>();

describe("deep-agent deriveTurnCommandProvenance", () => {
  it("cites the executed shell's OWN id for a per-command approval (same-row consent)", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["execute-1"]);
    expect(provenance!.authorizedByAutoApproveAll).toBe(false);
  });

  it("cites the executed shell's own id for an APPROVE_ALL on the same row", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE_ALL });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance!.consentToolCallIds).toEqual(["execute-1"]);
  });

  it("cites a prior APPROVE_ALL lease row for a command that ran ungated under the lease", () => {
    // Prior turn: a gated command the user approved-all (settled before this turn).
    const leaseRow = executedShell("lease-row", {
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      approvalAction: ApprovalAction.APPROVE_ALL,
    });
    // This turn: a fresh command runs ungated under the lease — no approval_action.
    const leased = executedShell("execute-leased");
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([leaseRow]), aiMessage([leased])]),
      priorSettledToolCallIds: new Set(["lease-row"]), // the lease row is a prior-turn settled call
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["lease-row"]);
  });

  it("flags auto_approve_all for an ungated command under the global bypass", () => {
    const shell = executedShell("execute-1"); // no approval_action, no lease
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: true,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual([]);
    expect(provenance!.authorizedByAutoApproveAll).toBe(true);
  });

  it("fails closed on a file-tool call this turn (even under auto_approve_all)", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const write = toolCall({ id: "write-1", name: "write_file", args: { path: "a.txt" } });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell, write])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: true,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on an MCP tool this turn", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const mcp = toolCall({ id: "mcp-1", name: "apply_resource", mcpServerSlug: "planton" });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell, mcp])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on an unrecognized tool name this turn", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const unknown = toolCall({ id: "u-1", name: "mystery_tool" });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell, unknown])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on a top-level sub-agent delegation (task row this turn)", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const task = toolCall({ id: "task-1", name: "task", args: { prompt: "go" } });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell, task])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed when a sub-agent produced NEW tool-call rows this turn", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const subAgentShell = executedShell("sub-execute-1", { approvalAction: ApprovalAction.APPROVE });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell])], [
        { name: "worker", messages: [aiMessage([subAgentShell])] },
      ]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS, // the sub-agent row is new this turn
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("does NOT fail closed for a sub-agent whose rows all pre-existed this turn", () => {
    const shell = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const priorSubShell = executedShell("sub-prior-1", { approvalAction: ApprovalAction.APPROVE });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([shell])], [
        { name: "worker", messages: [aiMessage([priorSubShell])] },
      ]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: new Set(["sub-prior-1"]), // seeded from a prior turn
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["execute-1"]);
  });

  it("returns undefined when no command executed this turn", () => {
    const pending = executedShell("execute-pending", {
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([pending])]),
      priorSettledToolCallIds: NO_SETTLED,
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  // ── Regression: identity scoping (the reason positional scoping can't port) ──

  it("REGRESSION counts a seeded WAITING_APPROVAL -> COMPLETED approved shell (its id was not settled pre-stream)", () => {
    // The shell was proposed + approved in a prior segment (WAITING_APPROVAL, so
    // NOT in the pre-stream settled snapshot) and executes in place this segment.
    const executedThisTurn = executedShell("execute-approved", {
      approvalAction: ApprovalAction.APPROVE,
    });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([executedThisTurn])]),
      priorSettledToolCallIds: NO_SETTLED, // it was WAITING, not settled, before the stream
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["execute-approved"]);
  });

  it("REGRESSION does NOT re-count a prior turn's already-settled shell", () => {
    const priorShell = executedShell("execute-prior", { approvalAction: ApprovalAction.APPROVE });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([priorShell])]),
      priorSettledToolCallIds: new Set(["execute-prior"]), // settled in a prior turn
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    // Nothing executed THIS turn -> nothing to attribute the change set to.
    expect(provenance).toBeUndefined();
  });

  it("REGRESSION a prior turn's settled non-shell call never disqualifies this turn", () => {
    // A prior FAILED edit must be excluded by the settled snapshot — otherwise it
    // would trip the !== SHELL fail-closed on a clean shell-only turn.
    const priorEdit = toolCall({
      id: "edit-prior",
      name: "edit_file",
      status: ToolCallStatus.TOOL_CALL_FAILED,
      args: { path: "a.txt" },
    });
    const shellThisTurn = executedShell("execute-1", { approvalAction: ApprovalAction.APPROVE });
    const provenance = deriveTurnCommandProvenance({
      status: status([aiMessage([priorEdit]), aiMessage([shellThisTurn])]),
      priorSettledToolCallIds: new Set(["edit-prior"]),
      priorSubAgentToolCallIds: NO_SUBAGENTS,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["execute-1"]);
  });
});
