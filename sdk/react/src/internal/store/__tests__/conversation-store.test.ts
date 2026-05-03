import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ConversationStore, type StreamState } from "../conversation-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(
  phase: ExecutionPhase,
  messages?: Array<{ type: MessageType; content: string }>,
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  status.phase = phase;
  if (messages) {
    status.messages = messages.map((m) => {
      const msg = create(AgentMessageSchema);
      msg.type = m.type;
      msg.content = m.content;
      return msg;
    });
  }
  exec.status = status;
  return exec;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationStore", () => {
  describe("initial state", () => {
    it("starts with null execution and idle stream state", () => {
      const store = new ConversationStore();
      expect(store.getExecution()).toBeNull();
      expect(store.getStreamState()).toEqual({ stage: "idle" });
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("notifies listeners on state changes", () => {
      const store = new ConversationStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.setStreamState({ stage: "connecting", executionId: "e1" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops notifying after unsubscribe", () => {
      const store = new ConversationStore();
      const listener = vi.fn();
      const unsub = store.subscribe(listener);

      store.setStreamState({ stage: "connecting", executionId: "e1" });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.setStreamState({ stage: "streaming", executionId: "e1" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("supports multiple listeners", () => {
      const store = new ConversationStore();
      const l1 = vi.fn();
      const l2 = vi.fn();
      store.subscribe(l1);
      store.subscribe(l2);

      store.setStreamState({ stage: "connecting", executionId: "e1" });
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("ingestSnapshot", () => {
    it("stores execution and notifies listeners", () => {
      const store = new ConversationStore();
      const listener = vi.fn();
      store.subscribe(listener);

      const snapshot = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
        { type: MessageType.MESSAGE_AI, content: "hello" },
      ]);
      store.ingestSnapshot(snapshot);

      expect(store.getExecution()).toBe(snapshot);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when structural sharing produces the same reference", () => {
      const store = new ConversationStore();
      const snapshot = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
        { type: MessageType.MESSAGE_AI, content: "hello" },
      ]);
      store.ingestSnapshot(snapshot);

      const listener = vi.fn();
      store.subscribe(listener);

      const identical = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
        { type: MessageType.MESSAGE_AI, content: "hello" },
      ]);
      store.ingestSnapshot(identical);

      expect(listener).not.toHaveBeenCalled();
      expect(store.getExecution()).toBe(snapshot);
    });

    it("applies structural sharing: preserves unchanged message refs", () => {
      const store = new ConversationStore();
      const snap1 = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
        { type: MessageType.MESSAGE_HUMAN, content: "question" },
        { type: MessageType.MESSAGE_AI, content: "partial" },
      ]);
      store.ingestSnapshot(snap1);

      const prevMsgs = store.getExecution()!.status!.messages;
      const humanMsg = prevMsgs[0];

      const snap2 = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
        { type: MessageType.MESSAGE_HUMAN, content: "question" },
        { type: MessageType.MESSAGE_AI, content: "partial answer growing" },
      ]);
      store.ingestSnapshot(snap2);

      const result = store.getExecution()!;
      expect(result.status!.messages[0]).toBe(humanMsg);
      expect(result.status!.messages[1].content).toBe(
        "partial answer growing",
      );
    });
  });

  describe("setStreamState", () => {
    it("transitions between stages and notifies", () => {
      const store = new ConversationStore();
      const listener = vi.fn();
      store.subscribe(listener);

      const states: StreamState[] = [
        { stage: "connecting", executionId: "e1" },
        { stage: "streaming", executionId: "e1" },
        { stage: "complete", executionId: "e1" },
      ];

      for (const state of states) {
        store.setStreamState(state);
      }

      expect(listener).toHaveBeenCalledTimes(3);
      expect(store.getStreamState()).toEqual({
        stage: "complete",
        executionId: "e1",
      });
    });

    it("does not notify when set to the same state", () => {
      const store = new ConversationStore();
      store.setStreamState({ stage: "connecting", executionId: "e1" });

      const listener = vi.fn();
      store.subscribe(listener);

      store.setStreamState({ stage: "connecting", executionId: "e1" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("handles error state", () => {
      const store = new ConversationStore();
      const err = new Error("network failure");
      store.setStreamState({ stage: "error", executionId: "e1", error: err });

      const state = store.getStreamState();
      expect(state.stage).toBe("error");
      if (state.stage === "error") {
        expect(state.error).toBe(err);
      }
    });
  });

  describe("reset", () => {
    it("clears execution and stream state", () => {
      const store = new ConversationStore();
      store.ingestSnapshot(
        makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS, [
          { type: MessageType.MESSAGE_AI, content: "hi" },
        ]),
      );
      store.setStreamState({ stage: "streaming", executionId: "e1" });

      const listener = vi.fn();
      store.subscribe(listener);

      store.reset();

      expect(store.getExecution()).toBeNull();
      expect(store.getStreamState()).toEqual({ stage: "idle" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when already in initial state", () => {
      const store = new ConversationStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.reset();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("getExecution / getStreamState referential stability", () => {
    it("getExecution returns the same reference across calls when unchanged", () => {
      const store = new ConversationStore();
      const snap = makeExec(ExecutionPhase.EXECUTION_IN_PROGRESS);
      store.ingestSnapshot(snap);

      const ref1 = store.getExecution();
      const ref2 = store.getExecution();
      expect(ref1).toBe(ref2);
    });

    it("getStreamState returns the same reference across calls when unchanged", () => {
      const store = new ConversationStore();
      store.setStreamState({ stage: "connecting", executionId: "e1" });

      const ref1 = store.getStreamState();
      const ref2 = store.getStreamState();
      expect(ref1).toBe(ref2);
    });

    it("subscribe and getters are bound methods (safe to destructure)", () => {
      const store = new ConversationStore();
      const { subscribe, getExecution, getStreamState } = store;

      expect(getExecution()).toBeNull();
      expect(getStreamState()).toEqual({ stage: "idle" });

      const listener = vi.fn();
      const unsub = subscribe(listener);
      store.setStreamState({ stage: "connecting", executionId: "e1" });
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });
  });
});
