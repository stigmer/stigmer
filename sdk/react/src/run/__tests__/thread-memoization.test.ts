/**
 * Reference stability across a growing conversation, the property every
 * memoized row relies on: `toolCallGroupPropsEqual` compares a group's tool
 * uses element by element (the array is rebuilt per build), and the session
 * fold, folded incrementally as a live turn streams, keeps every message,
 * tool use, group member and subagent thread no event touched as the same
 * object, so buildThreadItems hands the rows the same references and only the
 * changing row re-renders.
 */
import { describe, it, expect } from "vitest";
import { SessionLog, type ToolUse } from "@stigmer/client";
import { toolCallGroupPropsEqual, type ToolCallGroupProps } from "../ToolCallGroup";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { samples } from "@stigmer/react-core/test";
import {
  previewDelta,
  previewStart,
  result,
  said,
  status,
  subagent,
  toolId,
  use,
  user,
} from "./__fixtures__/thread-events";

const R = "run_a";

describe("toolCallGroupPropsEqual", () => {
  const a = samples.toolUse("shell", "ok", { id: "a" });
  const b = samples.toolUse("read_file", "ok", { id: "b" });

  it("is true when both arrays hold the same tool uses", () => {
    expect(toolCallGroupPropsEqual({ toolUses: [a, b] }, { toolUses: [a, b] })).toBe(true);
    expect(toolCallGroupPropsEqual({ toolUses: [] }, { toolUses: [] })).toBe(true);
  });

  it("is false when the lengths differ or a tool use is another object", () => {
    expect(toolCallGroupPropsEqual({ toolUses: [a] }, { toolUses: [a, b] })).toBe(false);
    const copy: ToolUse = { ...a };
    expect(toolCallGroupPropsEqual({ toolUses: [a] }, { toolUses: [copy] })).toBe(false);
  });

  it("is false when the class name or the summary formatter changes", () => {
    const base: ToolCallGroupProps = { toolUses: [a], className: "stg:mx-4", formatSummary: () => "s" };
    expect(toolCallGroupPropsEqual(base, { ...base, className: "stg:mx-6" })).toBe(false);
    expect(toolCallGroupPropsEqual(base, { ...base, formatSummary: () => "s" })).toBe(false);
  });
});

describe("the fold keeps unchanged items as the same objects across builds", () => {
  function itemsOf(log: SessionLog): ThreadItem[] {
    return buildThreadItems(log.snapshot().turns, []);
  }

  function byKey(items: readonly ThreadItem[], key: string): ThreadItem | undefined {
    return items.find((i) => i.key === key);
  }

  it("keeps a settled message and tool group while a later message streams", () => {
    const log = new SessionLog();
    log.apply(samples.sessionEventList([
      user(R, "Hello"),
      status(R, "running"),
      said(R, 0, "Full response"),
      use(R, "c1", "shell", { command: "ls" }),
      result(R, "c1", "a.txt"),
    ]).events);
    log.applyFrame(previewStart(`${R}.root.m1`));
    log.applyFrame(previewDelta(`${R}.root.m1`, "streaming par"));
    const before = itemsOf(log);

    log.applyFrame(previewDelta(`${R}.root.m1`, "tial text"));
    const after = itemsOf(log);

    const settled = `${R}.root.m0`;
    const group = `${toolId(R, "c1")}-tc`;
    const live = `${R}.root.m1`;
    const settledBefore = byKey(before, settled);
    const settledAfter = byKey(after, settled);
    expect(settledBefore?.kind === "message" && settledAfter?.kind === "message" && settledAfter.message === settledBefore.message).toBe(true);

    const groupBefore = byKey(before, group);
    const groupAfter = byKey(after, group);
    expect(
      groupBefore?.kind === "tool-group" &&
        groupAfter?.kind === "tool-group" &&
        toolCallGroupPropsEqual({ toolUses: groupBefore.toolUses }, { toolUses: groupAfter.toolUses }),
    ).toBe(true);

    const liveBefore = byKey(before, live);
    const liveAfter = byKey(after, live);
    expect(liveBefore?.kind === "message" && liveBefore.message).toMatchObject({ kind: "message", text: "streaming par", live: true });
    expect(liveAfter?.kind === "message" && liveAfter.message).toMatchObject({ text: "streaming partial text", live: true });
    expect(liveAfter?.kind === "message" && liveBefore?.kind === "message" && liveAfter.message !== liveBefore.message).toBe(true);
  });

  it("replaces the live message in place, under the same key, when its stored event arrives", () => {
    const log = new SessionLog();
    log.apply(samples.sessionEventList([user(R, "Hello"), status(R, "running")]).events);
    log.applyFrame(previewStart(`${R}.root.m0`));
    log.applyFrame(previewDelta(`${R}.root.m0`, "Hi"));
    const live = itemsOf(log);

    log.applyFrame(samples.eventFrame(said(R, 0, "Hi there")));
    const stored = itemsOf(log);

    expect(live.map((i) => i.key)).toEqual(stored.map((i) => i.key).filter((k) => live.some((i) => i.key === k)));
    const message = byKey(stored, `${R}.root.m0`);
    expect(message?.kind === "message" && message.message).toMatchObject({ text: "Hi there", live: false });
  });

  it("keeps a finished subagent's thread while the parent turn goes on", () => {
    const threadId = toolId(R, "task1");
    const log = new SessionLog();
    log.apply(samples.sessionEventList([
      user(R, "go"),
      status(R, "running"),
      use(R, "task1", "task"),
      subagent(R, "task1", { items: [said(R, 0, "nested", threadId)], finished: "completed", reply: "done" }),
      result(R, "task1", "done"),
    ].flat()).events);
    const before = byKey(itemsOf(log), `sa-${threadId}`);

    log.applyFrame(samples.eventFrame(said(R, 0, "Next step")));
    const after = byKey(itemsOf(log), `sa-${threadId}`);

    expect(before?.kind === "subagent" && after?.kind === "subagent" && after.thread === before.thread).toBe(true);
    expect(before?.kind === "subagent" && after?.kind === "subagent" && after.toolUse === before.toolUse).toBe(true);
  });
});
