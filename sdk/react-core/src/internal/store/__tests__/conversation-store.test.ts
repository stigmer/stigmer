/**
 * Proves the ConversationStore (../conversation-store.ts): frames fold into
 * the session log without notifying, a publish exposes the log's fold and
 * notifies only when it changed, the fold keeps unchanged objects by
 * reference, `lastSeq` follows the newest event, the follow's stage and its
 * watchdog signals notify only on a real change, and a reset empties
 * everything (silently when already clean).
 */
import { describe, it, expect, vi } from "vitest";
import { samples } from "../../../test/samples";
import { ConversationStore, type StreamState } from "../conversation-store";

const frames = (events: ReturnType<typeof samples.turnEvents>) =>
  events.map((event, index) => samples.eventFrame({ ...event, seq: BigInt(index + 1) }));

describe("ConversationStore", () => {
  it("starts with no fold and an idle follow", () => {
    const store = new ConversationStore();
    expect(store.getFold()).toBeNull();
    expect(store.getStreamState()).toEqual({ stage: "idle" });
    expect(store.getConnectTimedOut()).toBe(false);
    expect(store.getSlow()).toBe(false);
    expect(store.lastSeq).toBe(0n);
  });

  it("folds frames without notifying, and publishes the fold once", () => {
    const store = new ConversationStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const changed = frames(samples.turnEvents()).map((frame) => store.applyFrame(frame));
    expect(changed.every(Boolean)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getFold()).toBeNull();
    expect(store.lastSeq).toBe(4n);

    store.publish();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getFold()?.turns.map((turn) => turn.answer)).toEqual([
      "Of course! I'd be happy to help you get started. What would you like to work on?",
    ]);
  });

  it("does not notify when a publish finds nothing new", () => {
    const store = new ConversationStore();
    for (const frame of frames(samples.turnEvents())) store.applyFrame(frame);
    store.publish();
    const listener = vi.fn();
    store.subscribe(listener);
    const first = store.getFold();

    // An event already folded changes nothing.
    expect(store.applyFrame(samples.eventFrame({ ...samples.userMessageEvent("again"), seq: 1n }))).toBe(false);
    store.publish();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getFold()).toBe(first);
  });

  it("keeps an unchanged turn's object across publishes", () => {
    const store = new ConversationStore();
    for (const frame of frames(samples.turnEvents())) store.applyFrame(frame);
    store.publish();
    const firstTurn = store.getFold()!.turns[0];

    const second = samples.turnEvents({ runId: "run_2", message: "next" });
    second.forEach((event, index) => store.applyFrame(samples.eventFrame({ ...event, seq: BigInt(10 + index) })));
    store.publish();

    const fold = store.getFold()!;
    expect(fold.turns).toHaveLength(2);
    expect(fold.turns[0]).toBe(firstTurn);
    expect(fold.lastSeq).toBe(13n);
  });

  it("notifies on a stage change only", () => {
    const store = new ConversationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const connecting: StreamState = { stage: "connecting", sessionId: "s1" };

    store.setStreamState(connecting);
    store.setStreamState({ stage: "connecting", sessionId: "s1" });
    expect(listener).toHaveBeenCalledTimes(1);

    store.setStreamState({ stage: "connecting", sessionId: "s2" });
    expect(listener).toHaveBeenCalledTimes(2);
    store.setStreamState({ stage: "streaming", sessionId: "s2" });
    store.setStreamState({ stage: "streaming", sessionId: "s2" });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getStreamState()).toEqual({ stage: "streaming", sessionId: "s2" });
  });

  it("re-notifies each reconnect attempt and each new error", () => {
    const store = new ConversationStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setStreamState({ stage: "reconnecting", sessionId: "s", attempt: 1 });
    store.setStreamState({ stage: "reconnecting", sessionId: "s", attempt: 1 });
    store.setStreamState({ stage: "reconnecting", sessionId: "s", attempt: 2 });
    expect(listener).toHaveBeenCalledTimes(2);

    const error = new Error("gone");
    store.setStreamState({ stage: "error", sessionId: "s", error });
    store.setStreamState({ stage: "error", sessionId: "s", error });
    store.setStreamState({ stage: "error", sessionId: "s", error: new Error("again") });
    expect(listener).toHaveBeenCalledTimes(4);

    store.setStreamState({ stage: "idle" });
    store.setStreamState({ stage: "idle" });
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("notifies the watchdog signals only on a change", () => {
    const store = new ConversationStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setConnectTimedOut(true);
    store.setConnectTimedOut(true);
    store.setSlow(true);
    store.setSlow(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getConnectTimedOut()).toBe(true);
    expect(store.getSlow()).toBe(true);
  });

  it("resets to empty, notifying only when it held something", () => {
    const store = new ConversationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.reset();
    expect(listener).not.toHaveBeenCalled();

    for (const frame of frames(samples.turnEvents())) store.applyFrame(frame);
    store.publish();
    store.setStreamState({ stage: "streaming", sessionId: "s" });
    store.setConnectTimedOut(true);
    store.setSlow(true);
    listener.mockClear();

    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getFold()).toBeNull();
    expect(store.getStreamState()).toEqual({ stage: "idle" });
    expect(store.getConnectTimedOut()).toBe(false);
    expect(store.getSlow()).toBe(false);
    expect(store.lastSeq).toBe(0n);

    unsubscribe();
    store.setSlow(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
