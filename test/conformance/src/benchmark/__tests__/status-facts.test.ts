// Unit arms for the status-borne facts of a sample, over hand-built Run
// messages, and for what the user saw of the turn, over a hand-built session
// log folded (turn-events.ts).
// Domain: conformance benchmark.
//
// Pinned: int64 token counts become numbers; the cost estimate becomes
// micros; the priced model is read as reported; `status.error` is kept
// verbatim; memory on the status is one platform attachment; each terminal
// phase maps to its outcome; thinking counts as visible but not as text; a
// sub-agent's thread never counts; the final reply is the primary thread's
// last agent message.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { finalReply, outcomeOf, statusFacts, visibleRows } from "../status-facts";
import { said, subAgentThread, thought, turnFrom, userMessage } from "./turn-events";

describe("statusFacts", () => {
  it("reads tokens, the cost estimate in micros, the priced model and the server's stamps", () => {
    const execution = create(RunSchema, {
      metadata: { id: "run_1" },
      spec: { target: { case: "sessionId", value: "ses_1" } },
      status: {
        phase: RunPhase.RUN_COMPLETED,
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
      execution_id: "run_1",
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
      error: "",
      attachment_count: 0,
    });
  });

  it("keeps the platform's error on a failed turn and counts memory on the status as one attachment", () => {
    const facts = statusFacts(
      create(RunSchema, {
        status: {
          phase: RunPhase.RUN_FAILED,
          error: "provider returned 529 overloaded",
          recalledMemories: { enabled: true },
        },
      }),
    );
    expect(facts.error).toBe("provider returned 529 overloaded");
    expect(facts.attachment_count).toBe(1);
  });

  it("reads zeros and an empty model when the runner reported no usage", () => {
    const facts = statusFacts(create(RunSchema, { status: { phase: RunPhase.RUN_FAILED } }));
    expect(facts.tokens.total).toBe(0);
    expect(facts.model_reported).toBe("");
    expect(facts.outcome).toBe("failed");
  });
});

describe("outcomeOf", () => {
  it("maps each terminal phase to the sample's outcome", () => {
    expect(outcomeOf(RunPhase.RUN_COMPLETED)).toBe("completed");
    expect(outcomeOf(RunPhase.RUN_FAILED)).toBe("failed");
    expect(outcomeOf(RunPhase.RUN_CANCELLED)).toBe("cancelled");
    expect(outcomeOf(RunPhase.RUN_TERMINATED)).toBe("cancelled");
    expect(outcomeOf(undefined)).toBe("failed");
  });
});

describe("finalReply", () => {
  it("is the primary thread's last agent message, never a sub-agent's", () => {
    const turn = turnFrom([
      userMessage("fix it"),
      said(0, "Reading the file."),
      said(1, "Fixed: 90s is now 1 minute."),
      ...subAgentThread("task1", "sub-agent text"),
    ]);
    expect(finalReply(turn)).toBe("Fixed: 90s is now 1 minute.");
    expect(finalReply(undefined)).toBe("");
    expect(finalReply(turnFrom([userMessage("hi")]))).toBe("");
  });
});

describe("visibleRows", () => {
  it("thinking is visible but not text; an agent message is both", () => {
    expect(visibleRows(turnFrom([userMessage("hi"), ...thought(0, "hmm")]))).toEqual({ visible: true, text: false });
    expect(visibleRows(turnFrom([userMessage("hi"), said(0, "Hello.")]))).toEqual({ visible: true, text: true });
  });

  it("an empty message and a sub-agent's message are not visible", () => {
    const turn = turnFrom([userMessage("hi"), said(0, ""), ...subAgentThread("task1", "sub-agent text")]);
    expect(visibleRows(turn)).toEqual({ visible: false, text: false });
    expect(visibleRows(undefined)).toEqual({ visible: false, text: false });
  });
});
