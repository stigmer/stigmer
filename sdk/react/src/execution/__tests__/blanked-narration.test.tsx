import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
  ToolCallSchema,
  type AgentMessage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems } from "../MessageThread";
import { MessageEntry } from "../MessageEntry";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Phase 5 — Cursor deny-only normalization (append-only by construction).
//
// When a Cursor turn pauses for approval, the runner BLANKS (clears the content
// of) the model's provisional post-denial narration in place rather than
// removing the messages — so the WAITING_FOR_APPROVAL finalize is append-only
// and the backend needs no shrink exception. The cleanliness then lives in the
// DATA: the SDK's existing empty-message handling renders the blanked messages
// as nothing, so no per-harness UI special-casing is required.
//
// These tests LOCK that existing handling. If a future refactor "un-hides"
// empty messages, these fail loudly — the runner's blanked narration must never
// silently leak back into any surface.
// ---------------------------------------------------------------------------

function aiText(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content });
}

function thinking(content: string): AgentMessage {
  return create(AgentMessageSchema, { type: MessageType.MESSAGE_THINKING, content });
}

function gatedAiMessage(): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    toolCalls: [
      create(ToolCallSchema, {
        id: "c1",
        name: "edit",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      }),
    ],
  });
}

/**
 * The exact transcript the runner persists after redaction: pre-tool text, the
 * gated tool call (WAITING_APPROVAL), then the blanked provisional narration
 * (a THINKING and an AI message, both with empty content). Count preserved.
 */
function waitingForApprovalExecution(): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: "exec-hitl" });
  exec.spec = create(AgentExecutionSpecSchema, { message: "make the change" });
  exec.status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    messages: [
      aiText("Let me create the file."),
      gatedAiMessage(),
      thinking(""), // blanked provisional reasoning
      aiText(""), // blanked provisional verdict
    ],
  });
  return exec;
}

describe("buildThreadItems — blanked post-denial narration (Phase 5)", () => {
  it("surfaces the approval tool-group but emits no narration message item", () => {
    const exec = waitingForApprovalExecution();

    const items = buildThreadItems([exec], null, null, true, undefined);

    // The approval surface is driven by the WAITING_APPROVAL tool call — its
    // tool-group is present.
    const toolGroups = items.filter((i) => i.kind === "tool-group");
    expect(toolGroups).toHaveLength(1);
    expect(toolGroups[0].kind === "tool-group" && toolGroups[0].toolCalls[0].status).toBe(
      ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    );

    // The pre-tool text survives as the only non-empty AI message item; the
    // blanked AI verdict is gone.
    const messageItems = items.filter((i) => i.kind === "message");
    const nonEmptyAi = messageItems.filter(
      (i) =>
        i.kind === "message" &&
        i.message.type === MessageType.MESSAGE_AI &&
        i.message.content.trim().length > 0,
    );
    expect(nonEmptyAi).toHaveLength(1);
    expect(nonEmptyAi[0].kind === "message" && nonEmptyAi[0].message.content).toBe(
      "Let me create the file.",
    );

    // No message item carries the provisional narration text. The empty AI
    // verdict is skipped entirely; the empty THINKING (if emitted) carries no
    // content and renders nothing (asserted below at the render layer).
    for (const item of messageItems) {
      if (item.kind !== "message") continue;
      expect(item.message.content).not.toContain("enable the hook");
    }
  });

  it("the empty AI verdict is skipped and the empty THINKING carries no content", () => {
    const exec = waitingForApprovalExecution();

    const items = buildThreadItems([exec], null, null, true, undefined);
    const messageItems = items.filter((i) => i.kind === "message");

    // The empty AI verdict is dropped from the item list entirely (empty-AI
    // skip). Any surviving message item (e.g. the empty THINKING) has no
    // content, so the render layer hides it (asserted below).
    for (const item of messageItems) {
      if (item.kind !== "message") continue;
      if (item.message.type === MessageType.MESSAGE_AI) {
        expect(item.message.content.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("MessageEntry — blanked narration renders nothing (Phase 5)", () => {
  it("renders nothing for a blanked AI narration message", () => {
    const { container } = render(<MessageEntry message={aiText("")} />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders nothing for a blanked THINKING narration message", () => {
    const { container } = render(<MessageEntry message={thinking("")} />);
    expect(container.innerHTML).toBe("");
  });
});
