// Unit arms for the subscribe watcher, over an in-process async iterable of
// snapshots and a scripted clock.
// Domain: conformance benchmark.
//
// Pinned: the first-visible and first-text stamps are taken at the arrival
// of the first snapshot that shows them and never move; the end-to-end stamp
// is the terminal snapshot's arrival; every axis is relative to the create
// call's start; a stream that never reaches a terminal phase reports a
// timeout with a null end-to-end and keeps what it did see.
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentExecutionSchema, type AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { watchExecution } from "../stream-watch";

function snapshot(phase: ExecutionPhase, rows: Array<{ type: MessageType; content: string }>): AgentExecution {
  return create(AgentExecutionSchema, { metadata: { id: "aex_1" }, status: { phase, messages: rows } });
}

function scripted(snapshots: AgentExecution[]): (signal: AbortSignal) => AsyncIterable<AgentExecution> {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (const item of snapshots) yield item;
    },
  });
}

describe("watchExecution", () => {
  it("stamps first-visible on the THINKING row, first-text on the AI row, and end-to-end on the terminal snapshot", async () => {
    const clock = [1000, 1400, 2100, 3000];
    let tick = 0;
    const watched = await watchExecution(
      scripted([
        snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, [{ type: MessageType.MESSAGE_HUMAN, content: "hi" }]),
        snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, [{ type: MessageType.MESSAGE_THINKING, content: "hmm" }]),
        snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, [
          { type: MessageType.MESSAGE_THINKING, content: "hmm" },
          { type: MessageType.MESSAGE_AI, content: "Hel" },
        ]),
        snapshot(ExecutionPhase.EXECUTION_COMPLETED, [
          { type: MessageType.MESSAGE_THINKING, content: "hmm" },
          { type: MessageType.MESSAGE_AI, content: "Hello." },
        ]),
      ]),
      { startedAtMs: 500, timeoutMs: 10_000, now: () => clock[tick++] ?? 9999 },
    );
    expect(watched.client_first_visible_token_ms).toBe(900);
    expect(watched.client_first_text_ms).toBe(1600);
    expect(watched.end_to_end_ms).toBe(2500);
    expect(watched.outcome).toBe("until");
    expect(watched.final?.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("a stream that never turns terminal is a timeout with a null end-to-end and the stamps it did take", async () => {
    // Honours the abort the bounded reader sends, the way a Connect stream
    // does: the iterable ends with Canceled once the deadline passes.
    const forever = (signal: AbortSignal): AsyncIterable<AgentExecution> => ({
      async *[Symbol.asyncIterator]() {
        yield snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, [{ type: MessageType.MESSAGE_AI, content: "Hel" }]);
        await new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ConnectError("aborted", Code.Canceled)), { once: true });
        });
      },
    });
    const watched = await watchExecution(forever, { startedAtMs: 0, timeoutMs: 50, now: () => 20 });
    expect(watched.outcome).toBe("timeout");
    expect(watched.end_to_end_ms).toBeNull();
    expect(watched.client_first_text_ms).toBe(20);
  });
});
