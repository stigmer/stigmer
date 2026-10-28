/**
 * The open-operation fold (`../open-operations.ts`), one arm per rule: a
 * start opens, a finish, an error or a proposal closes, a recovery's replayed
 * start of a settled call stays closed, a delegating call never counts (in
 * either order of its two facts), the
 * close of the last counted call is the idle instant, the oldest open
 * call is the backstop's, aged on the fold's clock, and the turn awaits its
 * model while a round is open or while a tool's result is unanswered. A
 * round a model call that threw left open (it never finishes) ends when its
 * scope's next round starts or its sub-agent ends. A scope waiting for its
 * background commands holds the watchdog until its wait ends, which is the
 * idle instant, and is neither an operation nor the model.
 */

import { describe, expect, it, vi } from "vitest";

import { OpenOperations } from "../open-operations.js";
import type { TranscriptEvent } from "../transcript/events.js";

function started(callId: string, name = "execute", subAgentId?: string): TranscriptEvent {
  return { kind: "tool_started", callId, name, input: {}, mcpServerSlug: "", ...(subAgentId !== undefined ? { subAgentId } : {}) };
}

function delegated(subAgentId: string): TranscriptEvent {
  return { kind: "sub_agent_started", subAgentId, name: "helper", subject: "work", input: "work" };
}

function fold() {
  let now = 1_000;
  const onIdle = vi.fn();
  const operations = new OpenOperations({ onIdle, now: () => now });
  return { operations, onIdle, advance: (ms: number) => (now += ms) };
}

describe("OpenOperations", () => {
  it("opens a call on its start and closes it on its finish", () => {
    const { operations, onIdle } = fold();
    expect(operations.held()).toBe(false);
    operations.observe(started("c1"));
    expect(operations.held()).toBe(true);
    operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
    expect(operations.held()).toBe(false);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("closes a call on its error, and a held call on its proposal: a call waiting for a person is not running", () => {
    const { operations } = fold();
    operations.observe(started("c1"));
    operations.observe({ kind: "tool_error", callId: "c1", message: "boom" });
    expect(operations.held()).toBe(false);

    operations.observe(started("c2", "shell"));
    operations.observe({ kind: "approval_proposed", callId: "c2", name: "shell", mcpServerSlug: "", message: "Run it?" });
    expect(operations.held()).toBe(false);
  });

  it("keeps a settled call closed when a recovery replays its start", () => {
    const { operations, onIdle } = fold();
    operations.observe(started("c1"));
    operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
    operations.observe(started("c1"));
    expect(operations.held()).toBe(false);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("reports idle only when the LAST counted call closes", () => {
    const { operations, onIdle } = fold();
    operations.observe(started("c1"));
    operations.observe(started("c2"));
    operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
    expect(onIdle).not.toHaveBeenCalled();
    expect(operations.held()).toBe(true);
    operations.observe({ kind: "tool_finished", callId: "c2", result: "ok" });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("ignores a close of a call it never saw open", () => {
    const { operations, onIdle } = fold();
    operations.observe({ kind: "tool_finished", callId: "ghost", result: "ok" });
    expect(onIdle).not.toHaveBeenCalled();
    expect(operations.held()).toBe(false);
  });

  describe("a delegating call", () => {
    it("does not count (native announces the sub-agent first); the sub-agent's own call does", () => {
      const { operations } = fold();
      operations.observe(delegated("task-1"));
      operations.observe(started("task-1", "task"));
      expect(operations.held(), "the delegating call alone holds nothing").toBe(false);

      operations.observe(started("inner-1", "execute", "task-1"));
      expect(operations.held(), "the sub-agent's running tool does").toBe(true);
      expect(operations.oldest()).toMatchObject({ callId: "inner-1", name: "execute", subAgentId: "task-1" });
    });

    it("stops counting when its sub-agent is announced after it starts, and that is the idle instant", () => {
      const { operations, onIdle } = fold();
      operations.observe(started("task-1", "task"));
      expect(operations.held()).toBe(true);
      operations.observe(delegated("task-1"));
      expect(operations.held()).toBe(false);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

  });

  it("names the oldest counted call with its age on the fold's clock", () => {
    const { operations, advance } = fold();
    expect(operations.oldest()).toBeUndefined();
    operations.observe(started("c1", "execute"));
    advance(5_000);
    operations.observe(delegated("task-1"));
    operations.observe(started("task-1", "task"));
    operations.observe(started("c2", "web_fetch"));
    advance(10_000);
    expect(operations.oldest()).toEqual({ callId: "c1", name: "execute", openedAtMs: 1_000, ageMs: 15_000 });

    operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
    expect(operations.oldest()).toMatchObject({ callId: "c2", ageMs: 10_000 });
  });

  it("is not moved by the stream's other facts", () => {
    const { operations } = fold();
    operations.observe(started("c1"));
    operations.observe({ kind: "tool_output_delta", callId: "c1", delta: "line\n" });
    operations.observe({ kind: "text_delta", runId: "r", text: "hi" });
    operations.observe({ kind: "sub_agent_finished", subAgentId: "other" });
    expect(operations.held()).toBe(true);
  });

  describe("the snapshot a liveness names", () => {
    it("lists every counted call oldest first, each aged at the read, and waits on nothing while one runs", () => {
      const { operations, advance } = fold();
      expect(operations.snapshot()).toEqual({ operations: [], awaitingModelMs: undefined });
      operations.observe(started("c2", "web_fetch"));
      advance(2_000);
      operations.observe(started("c1", "execute", "sub-1"));
      operations.observe(delegated("task-1"));
      operations.observe(started("task-1", "task"));
      advance(3_000);
      expect(operations.snapshot()).toEqual({
        operations: [
          { callId: "c2", name: "web_fetch", openedAtMs: 1_000, ageMs: 5_000 },
          { callId: "c1", name: "execute", subAgentId: "sub-1", openedAtMs: 3_000, ageMs: 3_000 },
        ],
        awaitingModelMs: undefined,
      });
    });

    it("ages the wait on the model from the first open round, or from the unanswered result", () => {
      const { operations, advance } = fold();
      operations.observe({ kind: "message_start", runId: "r1" });
      advance(1_000);
      operations.observe({ kind: "message_start", runId: "r1" });
      advance(1_000);
      expect(operations.snapshot().awaitingModelMs, "a repeated start keeps the round's first instant").toBe(2_000);
      operations.observe({ kind: "message_finish", runId: "r1" });
      operations.observe(started("c1"));
      advance(4_000);
      operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
      advance(1_500);
      expect(operations.snapshot()).toEqual({ operations: [], awaitingModelMs: 1_500 });
    });
  });

  describe("awaiting the model", () => {
    it("is not waiting on a turn that has folded nothing", () => {
      expect(fold().operations.awaitingModel()).toBe(false);
    });

    it("is waiting while a model round is open, and not once it finishes with nothing after", () => {
      const { operations } = fold();
      operations.observe({ kind: "message_start", runId: "r1" });
      expect(operations.awaitingModel()).toBe(true);
      operations.observe({ kind: "message_finish", runId: "r1" });
      expect(operations.awaitingModel()).toBe(false);
    });

    it("is waiting once a tool's result arrives and nothing has answered it", () => {
      const { operations } = fold();
      operations.observe(started("c1"));
      expect(operations.awaitingModel(), "a running tool is the tool's, not the model's").toBe(false);
      operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
      expect(operations.awaitingModel()).toBe(true);
      operations.observe({ kind: "message_start", runId: "r2" });
      operations.observe({ kind: "message_finish", runId: "r2" });
      expect(operations.awaitingModel(), "the model answered the result").toBe(false);
    });

    it("counts a failed tool's error as a result, and a call started after it as the answer", () => {
      const { operations } = fold();
      operations.observe(started("c1"));
      operations.observe({ kind: "tool_error", callId: "c1", message: "boom" });
      expect(operations.awaitingModel()).toBe(true);
      operations.observe(started("c2"));
      expect(operations.awaitingModel()).toBe(false);
    });

    it("ends a round that never finished when the next round of its scope starts: a failed call and its retry", () => {
      const { operations } = fold();
      operations.observe({ kind: "message_start", runId: "failed" });
      operations.observe({ kind: "message_start", runId: "retry" });
      operations.observe({ kind: "message_finish", runId: "retry" });
      expect(operations.awaitingModel(), "the failed call's round is over").toBe(false);
      operations.observe(started("c1"));
      expect(operations.snapshot().awaitingModelMs, "a running tool is not a wait on the model").toBeUndefined();
    });

    it("keeps another scope's round open: a sub-agent's call is not the root's", () => {
      const { operations } = fold();
      operations.observe({ kind: "message_start", runId: "root" });
      operations.observe({ kind: "message_start", runId: "sub-1", subAgentId: "task-1" });
      operations.observe({ kind: "message_start", runId: "sub-2", subAgentId: "task-1" });
      operations.observe({ kind: "message_finish", runId: "root" });
      operations.observe({ kind: "message_finish", runId: "sub-2" });
      expect(operations.awaitingModel(), "the sub-agent's first round ended at its second").toBe(false);
    });

    it("ends a sub-agent's open round when the sub-agent finishes or fails", () => {
      const { operations } = fold();
      operations.observe({ kind: "message_start", runId: "sub-1", subAgentId: "task-1" });
      operations.observe({ kind: "sub_agent_failed", subAgentId: "task-1", error: "overloaded" });
      expect(operations.awaitingModel()).toBe(false);
      operations.observe({ kind: "message_start", runId: "sub-2", subAgentId: "task-2" });
      operations.observe({ kind: "sub_agent_finished", subAgentId: "task-2" });
      expect(operations.awaitingModel()).toBe(false);
    });

    it("is not waiting while another call is still running, nor on a proposal held for a person", () => {
      const { operations } = fold();
      operations.observe(started("c1"));
      operations.observe(started("c2"));
      operations.observe({ kind: "tool_finished", callId: "c1", result: "ok" });
      expect(operations.awaitingModel(), "c2 still runs").toBe(false);
      operations.observe({ kind: "approval_proposed", callId: "c2", name: "execute", mcpServerSlug: "", message: "ok?" });
      expect(operations.awaitingModel(), "the turn waits for a person").toBe(false);
    });
  });

  describe("a wait for background commands", () => {
    it("holds the watchdog from its start to its end, whose instant is the idle one", () => {
      const { operations, onIdle } = fold();
      operations.observe({ kind: "message_start", runId: "r1" });
      operations.observe({ kind: "message_finish", runId: "r1" });
      operations.observe({ kind: "background_wait_started" });
      expect(operations.held()).toBe(true);
      expect(operations.awaitingModel(), "the turn waits for its commands, not its model").toBe(false);
      operations.observe({ kind: "background_wait_finished" });
      expect(operations.held()).toBe(false);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it("is not an operation: neither the liveness snapshot nor the backstop names it", () => {
      const { operations, advance } = fold();
      operations.observe({ kind: "background_wait_started" });
      advance(7_200_000);
      expect(operations.snapshot()).toEqual({ operations: [], awaitingModelMs: undefined });
      expect(operations.oldest()).toBeUndefined();
    });

    it("keys each scope's wait apart: a sub-agent's end leaves the root's held", () => {
      const { operations, onIdle } = fold();
      operations.observe({ kind: "background_wait_started" });
      operations.observe({ kind: "background_wait_started", subAgentId: "task-1" });
      operations.observe({ kind: "background_wait_finished", subAgentId: "task-1" });
      expect(operations.held()).toBe(true);
      expect(onIdle).not.toHaveBeenCalled();
      operations.observe({ kind: "background_wait_finished" });
      expect(operations.held()).toBe(false);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it("leaves a call still running in charge of the idle instant", () => {
      const { operations, onIdle } = fold();
      operations.observe(started("c1"));
      operations.observe({ kind: "background_wait_started", subAgentId: "task-1" });
      operations.observe({ kind: "background_wait_finished", subAgentId: "task-1" });
      expect(onIdle, "c1 still runs").not.toHaveBeenCalled();
    });
  });
});
