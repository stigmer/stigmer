// Unit arms for the status-borne facts of a sample, over hand-built
// AgentExecution messages.
// Domain: conformance benchmark.
//
// Pinned: int64 token counts become numbers; the cost estimate becomes
// micros; the priced model is read as reported; each terminal phase maps to
// its outcome; a THINKING row counts as visible but not as text; sub-agent
// rows never count.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { outcomeOf, statusFacts, visibleRows } from "../status-facts";

describe("statusFacts", () => {
  it("reads tokens, the cost estimate in micros, the priced model and the server's stamps", () => {
    const execution = create(AgentExecutionSchema, {
      metadata: { id: "aex_1" },
      spec: { sessionId: "ses_1" },
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        startedAt: "2026-09-19T18:00:01Z",
        completedAt: "2026-09-19T18:00:05Z",
        audit: { specAudit: { createdAt: timestampFromDate(new Date("2026-09-19T18:00:00.000Z")) } },
        streamingUsage: {
          inputTokens: 1200n,
          outputTokens: 30n,
          cacheReadTokens: 1100n,
          cacheWriteTokens: 0n,
          totalTokens: 1230n,
          estimatedCostUsd: 0.003689,
          model: "claude-sonnet-4-6",
        },
      },
    });
    const facts = statusFacts(execution);
    expect(facts).toEqual({
      execution_id: "aex_1",
      session_id: "ses_1",
      model_reported: "claude-sonnet-4-6",
      tokens: { input: 1200, output: 30, cache_read: 1100, cache_write: 0, total: 1230 },
      estimated_cost_micros: 3689,
      server: {
        created_at: "2026-09-19T18:00:00.000Z",
        started_at: "2026-09-19T18:00:01Z",
        completed_at: "2026-09-19T18:00:05Z",
      },
      outcome: "completed",
    });
  });

  it("reads zeros and an empty model when the runner reported no usage", () => {
    const facts = statusFacts(create(AgentExecutionSchema, { status: { phase: ExecutionPhase.EXECUTION_FAILED } }));
    expect(facts.tokens.total).toBe(0);
    expect(facts.model_reported).toBe("");
    expect(facts.outcome).toBe("failed");
  });
});

describe("outcomeOf", () => {
  it("maps each terminal phase to the sample's outcome", () => {
    expect(outcomeOf(ExecutionPhase.EXECUTION_COMPLETED)).toBe("completed");
    expect(outcomeOf(ExecutionPhase.EXECUTION_FAILED)).toBe("failed");
    expect(outcomeOf(ExecutionPhase.EXECUTION_CANCELLED)).toBe("cancelled");
    expect(outcomeOf(ExecutionPhase.EXECUTION_TERMINATED)).toBe("cancelled");
    expect(outcomeOf(undefined)).toBe("failed");
  });
});

describe("visibleRows", () => {
  it("a THINKING row with content is visible but not text; an AI row is both", () => {
    const thinking = create(AgentExecutionSchema, {
      status: { messages: [{ type: MessageType.MESSAGE_THINKING, content: "hmm" }] },
    });
    expect(visibleRows(thinking)).toEqual({ visible: true, text: false });
    const ai = create(AgentExecutionSchema, {
      status: { messages: [{ type: MessageType.MESSAGE_HUMAN, content: "hi" }, { type: MessageType.MESSAGE_AI, content: "Hello." }] },
    });
    expect(visibleRows(ai)).toEqual({ visible: true, text: true });
  });

  it("an empty AI row and a sub-agent's row are not visible", () => {
    const execution = create(AgentExecutionSchema, {
      status: {
        messages: [{ type: MessageType.MESSAGE_AI, content: "" }],
        subAgentExecutions: [{ messages: [{ type: MessageType.MESSAGE_AI, content: "sub-agent text" }] }],
      },
    });
    expect(visibleRows(execution)).toEqual({ visible: false, text: false });
  });
});
