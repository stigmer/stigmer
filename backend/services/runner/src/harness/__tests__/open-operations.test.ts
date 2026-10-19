/**
 * The open-operation fold (`../open-operations.ts`), one arm per rule: a
 * start opens, a finish, an error or a proposal closes, a recovery's replayed
 * start of a settled call stays closed, a delegating call counts only where
 * sub-agents report at completion (in either order of its two facts), the
 * close of the last counted call is the idle instant, and the oldest open
 * call is the backstop's, aged on the fold's clock.
 */

import { describe, expect, it, vi } from "vitest";

import { OpenOperations } from "../open-operations.js";
import type { SubAgentProgress } from "../capabilities.js";
import type { TranscriptEvent } from "../transcript/events.js";

function started(callId: string, name = "execute", subAgentId?: string): TranscriptEvent {
  return { kind: "tool_started", callId, name, input: {}, mcpServerSlug: "", ...(subAgentId !== undefined ? { subAgentId } : {}) };
}

function delegated(subAgentId: string): TranscriptEvent {
  return { kind: "sub_agent_started", subAgentId, name: "helper", subject: "work", input: "work" };
}

function fold(progress: SubAgentProgress = "streamed") {
  let now = 1_000;
  const onIdle = vi.fn();
  const operations = new OpenOperations({ subAgentProgress: progress, onIdle, now: () => now });
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
    it("does not count where sub-agents stream (native announces the sub-agent first); the sub-agent's own call does", () => {
      const { operations } = fold("streamed");
      operations.observe(delegated("task-1"));
      operations.observe(started("task-1", "task"));
      expect(operations.held(), "the delegating call alone holds nothing").toBe(false);

      operations.observe(started("inner-1", "execute", "task-1"));
      expect(operations.held(), "the sub-agent's running tool does").toBe(true);
      expect(operations.oldest()).toMatchObject({ callId: "inner-1", name: "execute", subAgentId: "task-1" });
    });

    it("stops counting when its sub-agent is announced after it starts, and that is the idle instant", () => {
      const { operations, onIdle } = fold("streamed");
      operations.observe(started("task-1", "task"));
      expect(operations.held()).toBe(true);
      operations.observe(delegated("task-1"));
      expect(operations.held()).toBe(false);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it("counts where sub-agents report at completion, in either order", () => {
      const before = fold("at-completion");
      before.operations.observe(delegated("task-1"));
      before.operations.observe(started("task-1", "task"));
      expect(before.operations.held()).toBe(true);

      const after = fold("at-completion");
      after.operations.observe(started("task-1", "task"));
      after.operations.observe(delegated("task-1"));
      expect(after.operations.held()).toBe(true);
      expect(after.onIdle).not.toHaveBeenCalled();
    });
  });

  it("names the oldest counted call with its age on the fold's clock", () => {
    const { operations, advance } = fold("streamed");
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
});
