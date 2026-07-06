/**
 * Unit tests for the shared DD-28 qualification rule
 * ({@link qualifyTurnCommandProvenance}) — the harness-agnostic core both the
 * Cursor and deep-agent adapters delegate to.
 *
 * These exercise the rule in isolation over synthetic `turnToolCalls` (the
 * harness supplies the scoping + consent resolvers); each harness's own mapping
 * is covered by its adapter suite. The rule: a turn qualifies only when every
 * mutation-capable call it executed was a shell command with a provable consent
 * source (direct / lease / auto_approve_all), and every uncertainty fails closed.
 */

import { describe, it, expect } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { qualifyTurnCommandProvenance, findLeaseConsentId } from "../command-provenance.js";

function toolCall(overrides: MessageInitShape<typeof ToolCallSchema>): ToolCall {
  return create(ToolCallSchema, {
    id: "call-1",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    ...overrides,
  });
}

function aiMessageWith(toolCalls: ToolCall[]): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls });
}

// Default resolvers for the common "no direct consent, every listed call ran"
// case — individual tests override as needed.
const executedAlways = (): boolean => true;
const noDirectConsent = (): undefined => undefined;

function shell(id: string, cmd = "seq 1 5 > out.txt"): ToolCall {
  return toolCall({ id, name: "shell", args: { command: cmd } });
}

describe("qualifyTurnCommandProvenance", () => {
  it("cites the direct consent id the resolver returns", () => {
    const tc = shell("shell-1");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc],
      messages: [aiMessageWith([tc])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: (t) => (t.id === "shell-1" ? "consent-row" : undefined),
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["consent-row"]);
    expect(provenance!.authorizedByAutoApproveAll).toBe(false);
  });

  it("falls back to the APPROVE_ALL lease row when there is no direct consent", () => {
    const leaseRow = toolCall({
      id: "lease-row",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE_ALL,
    });
    const leased = shell("shell-leased");
    const messages = [aiMessageWith([leaseRow]), aiMessageWith([leased])];
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [leased],
      messages,
      isExecutedCommand: executedAlways,
      resolveDirectConsent: noDirectConsent,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["lease-row"]);
  });

  it("flags auto_approve_all when only the global bypass authorized the command", () => {
    const tc = shell("shell-1");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc],
      messages: [aiMessageWith([tc])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: noDirectConsent,
      globalBypass: true,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual([]);
    expect(provenance!.authorizedByAutoApproveAll).toBe(true);
  });

  it("prefers direct consent over auto_approve_all when both are available", () => {
    const tc = shell("shell-1");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc],
      messages: [aiMessageWith([tc])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: () => "consent-row",
      globalBypass: true,
    });
    expect(provenance!.consentToolCallIds).toEqual(["consent-row"]);
    expect(provenance!.authorizedByAutoApproveAll).toBe(false);
  });

  it("fails closed on a file-tool call (mixed turn)", () => {
    const tc = shell("shell-1");
    const edit = toolCall({ id: "edit-1", name: "edit", args: { path: "a.txt" } });
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc, edit],
      messages: [aiMessageWith([tc, edit])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: () => "consent-row",
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on an MCP tool", () => {
    const tc = shell("shell-1");
    const mcp = toolCall({ id: "mcp-1", name: "apply_resource", mcpServerSlug: "planton" });
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc, mcp],
      messages: [aiMessageWith([tc, mcp])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: () => "consent-row",
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on a sub-agent delegation (task -> SUBAGENT kind)", () => {
    const tc = shell("shell-1");
    const task = toolCall({ id: "task-1", name: "task", args: { prompt: "go" } });
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc, task],
      messages: [aiMessageWith([tc, task])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: () => "consent-row",
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on an unrecognized tool name", () => {
    const tc = shell("shell-1");
    const unknown = toolCall({ id: "u-1", name: "mystery_tool" });
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc, unknown],
      messages: [aiMessageWith([tc, unknown])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: () => "consent-row",
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("fails closed on an executed command with no provable consent source", () => {
    const tc = shell("shell-1");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [tc],
      messages: [aiMessageWith([tc])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: noDirectConsent,
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("returns undefined when no command executed (only a pending shell)", () => {
    const pending = shell("shell-pending");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [pending],
      messages: [aiMessageWith([pending])],
      isExecutedCommand: () => false, // pending / denied — never executed
      resolveDirectConsent: () => "consent-row",
      globalBypass: false,
    });
    expect(provenance).toBeUndefined();
  });

  it("skips read-only tools and hidden collapsed rows, then qualifies", () => {
    const read = toolCall({ id: "read-1", name: "read", args: { path: "a.txt" } });
    const hidden = toolCall({
      id: "hidden-1",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
      args: undefined,
    });
    const executed = shell("shell-executed");
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [read, hidden, executed],
      messages: [aiMessageWith([read, hidden, executed])],
      isExecutedCommand: executedAlways,
      resolveDirectConsent: (t) => (t.id === "shell-executed" ? "consent-row" : undefined),
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["consent-row"]);
  });

  it("dedupes consent ids across multiple commands citing the same lease", () => {
    const leaseRow = toolCall({
      id: "lease-row",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      approvalAction: ApprovalAction.APPROVE_ALL,
    });
    const a = shell("shell-a");
    const b = shell("shell-b");
    const messages = [aiMessageWith([leaseRow]), aiMessageWith([a, b])];
    const provenance = qualifyTurnCommandProvenance({
      turnToolCalls: [a, b],
      messages,
      isExecutedCommand: executedAlways,
      resolveDirectConsent: noDirectConsent,
      globalBypass: false,
    });
    expect(provenance).toBeDefined();
    expect(provenance!.consentToolCallIds).toEqual(["lease-row"]);
  });
});

describe("findLeaseConsentId", () => {
  it("returns the earliest APPROVE_ALL row of the tool's category", () => {
    const first = toolCall({ id: "lease-1", name: "shell", approvalAction: ApprovalAction.APPROVE_ALL });
    const second = toolCall({ id: "lease-2", name: "bash", approvalAction: ApprovalAction.APPROVE_ALL });
    const messages = [aiMessageWith([first]), aiMessageWith([second])];
    expect(findLeaseConsentId(messages, "execute")).toBe("lease-1");
  });

  it("returns undefined when no APPROVE_ALL lease exists for the category", () => {
    const writeApproveAll = toolCall({
      id: "w-1",
      name: "write",
      approvalAction: ApprovalAction.APPROVE_ALL,
    });
    const messages = [aiMessageWith([writeApproveAll])];
    // A write-category lease does not authorize a shell command.
    expect(findLeaseConsentId(messages, "shell")).toBeUndefined();
  });

  it("returns undefined for a non-gated (read-only) tool name", () => {
    const messages = [aiMessageWith([shell("s")])];
    expect(findLeaseConsentId(messages, "read")).toBeUndefined();
  });
});
