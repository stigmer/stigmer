/**
 * Unit tests for DeltaEnricher status promotion and finalize reconciliation.
 *
 * Validates:
 * - tool-call-completed delta promotes RUNNING -> COMPLETED (FM-2 fix)
 * - finalize() reconciliation catches orphaned RUNNING tool calls (FM-3 safety net)
 * - terminal statuses (FAILED, SKIPPED) are never overwritten
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ToolCallStreamingSource,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { InteractionUpdate } from "@cursor/sdk";
import { DeltaEnricher } from "../delta-enricher.js";

function makeMessage(toolCalls: Array<{
  id: string;
  name: string;
  status: ToolCallStatus;
  completedAt?: string;
  result?: string;
  isStreaming?: boolean;
}>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "test",
    toolCalls: toolCalls.map((tc) =>
      create(ToolCallSchema, {
        id: tc.id,
        name: tc.name,
        status: tc.status,
        completedAt: tc.completedAt ?? "",
        result: tc.result ?? "",
        isStreaming: tc.isStreaming ?? false,
        streamingSource: tc.isStreaming ? ToolCallStreamingSource.OUTPUT : ToolCallStreamingSource.UNSPECIFIED,
      }),
    ),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeltaEnricher tool-call-completed status promotion", () => {
  it("promotes RUNNING to COMPLETED when tool-call-completed delta arrives", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{ id: "tc-1", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
    ];

    enricher.processDelta({
      type: "tool-call-completed",
      callId: "tc-1",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    enricher.applyEnrichments(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).toBeTruthy();
  });

  it("does not overwrite COMPLETED status (idempotent)", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Shell",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        completedAt: "2026-01-01T00:00:00Z",
      }]),
    ];

    enricher.processDelta({
      type: "tool-call-completed",
      callId: "tc-1",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    enricher.applyEnrichments(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("does not overwrite FAILED status (terminal takes precedence)", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{ id: "tc-1", name: "Shell", status: ToolCallStatus.TOOL_CALL_FAILED }]),
    ];

    enricher.processDelta({
      type: "tool-call-completed",
      callId: "tc-1",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    enricher.applyEnrichments(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
  });

  it("sets timing on tool-call-started", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{ id: "tc-1", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
    ];

    enricher.processDelta({
      type: "tool-call-started",
      callId: "tc-1",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    enricher.applyEnrichments(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.startedAt).toBeTruthy();
  });
});

describe("DeltaEnricher finalize reconciliation", () => {
  it("promotes RUNNING tool call with completedAt to COMPLETED", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Execute Sql",
        status: ToolCallStatus.TOOL_CALL_RUNNING,
        completedAt: "2026-01-01T00:00:00Z",
      }]),
    ];

    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("promotes RUNNING tool call with non-empty result to COMPLETED", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Shell",
        status: ToolCallStatus.TOOL_CALL_RUNNING,
        result: "command output here",
      }]),
    ];

    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).toBeTruthy();
  });

  it("does not promote PENDING tool call without completion evidence", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Shell",
        status: ToolCallStatus.TOOL_CALL_PENDING,
      }]),
    ];

    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_PENDING);
  });

  it("does not promote RUNNING tool call without any completion evidence", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Shell",
        status: ToolCallStatus.TOOL_CALL_RUNNING,
      }]),
    ];

    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
  });

  it("clears isStreaming on all tool calls", () => {
    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{
        id: "tc-1",
        name: "Shell",
        status: ToolCallStatus.TOOL_CALL_RUNNING,
        isStreaming: true,
      }]),
    ];

    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.isStreaming).toBe(false);
    expect(tc.streamingSource).toBe(ToolCallStreamingSource.UNSPECIFIED);
  });

  it("reconciles tool calls across multiple messages", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([
        { id: "tc-1", name: "Read", status: ToolCallStatus.TOOL_CALL_COMPLETED },
        { id: "tc-2", name: "Execute Sql", status: ToolCallStatus.TOOL_CALL_RUNNING, result: "rows returned" },
      ]),
      makeMessage([
        { id: "tc-3", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING, completedAt: "2026-01-01T00:00:00Z" },
      ]),
    ];

    enricher.finalize(messages);

    expect(messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(messages[0].toolCalls[1].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(messages[1].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });
});

describe("DeltaEnricher recovery-retry stream epilogue", () => {
  // Regression for the zombie RUNNING row of aex_01kws27q1e2esvkqjpvectttxf:
  // the recovery retry's bare stream loop buffered the tool-call-completed
  // delta but never flushed it, so the row lacked the completedAt evidence
  // finalize's sweep requires and persisted as RUNNING forever. The epilogue
  // must applyEnrichments (flush the buffered evidence) BEFORE finalize.
  it("applyEnrichments + finalize promotes a retry's buffered-completion RUNNING row", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{ id: "tc-retry", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
    ];

    // The retry's onDelta buffered the completion, but the bare retry loop
    // never applied it to the transcript.
    enricher.processDelta({
      type: "tool-call-completed",
      callId: "tc-retry",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    // Without the flush, finalize alone cannot promote (no evidence on the row).
    const unflushed = makeMessage([
      { id: "tc-retry", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING },
    ]);
    new DeltaEnricher().finalize([unflushed]);
    expect(unflushed.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);

    // The epilogue sequence: flush the buffered evidence, then finalize.
    enricher.applyEnrichments(messages);
    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).toBeTruthy();
  });

  it("re-running applyEnrichments and finalize is idempotent", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const enricher = new DeltaEnricher();
    const messages: AgentMessage[] = [
      makeMessage([{ id: "tc-1", name: "Shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
    ];

    enricher.processDelta({
      type: "tool-call-completed",
      callId: "tc-1",
      toolCall: { type: "shell" },
    } as unknown as InteractionUpdate);

    // Primary epilogue ...
    enricher.applyEnrichments(messages);
    enricher.finalize(messages);
    const stamped = messages[0].toolCalls[0].completedAt;

    // ... and the retry epilogue re-runs both. The row must keep its original
    // completion evidence and terminal status.
    enricher.applyEnrichments(messages);
    enricher.finalize(messages);

    const tc = messages[0].toolCalls[0];
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).toBe(stamped);
  });
});
