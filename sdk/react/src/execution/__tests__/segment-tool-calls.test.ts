import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { segmentToolCalls } from "../segment-tool-calls";
import { registerToolPresenter } from "../tool-presenter";
import { ToolKind } from "@stigmer/sdk";

function tc(name: string, id: string, args?: Record<string, unknown>): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    args: (args ?? { path: `/x/${id}`, pattern: "p", command: "ls" }) as JsonObject,
  });
}

describe("segmentToolCalls", () => {
  it("folds a run of >= 2 consecutive same-category groupable calls", () => {
    const calls = [tc("Read", "r1"), tc("Read", "r2"), tc("Read", "r3")];
    const segments = segmentToolCalls(calls);

    expect(segments).toHaveLength(1);
    const [seg] = segments;
    expect(seg.kind).toBe("run");
    if (seg.kind === "run") {
      expect(seg.category).toBe("read");
      expect(seg.toolCalls).toHaveLength(3);
      // Slice preserves the original references (structural-sharing friendly).
      expect(seg.toolCalls[0]).toBe(calls[0]);
    }
  });

  it("leaves a lone groupable call as a row (no one-item chip)", () => {
    const calls = [tc("Read", "r1")];
    const segments = segmentToolCalls(calls);

    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("row");
  });

  it("never folds high-signal categories (shell, edit)", () => {
    const calls = [
      tc("Shell", "s1", { command: "echo a" }),
      tc("Shell", "s2", { command: "echo b" }),
      tc("StrReplace", "e1", { path: "/a.ts", old_string: "a", new_string: "b" }),
    ];
    const segments = segmentToolCalls(calls);

    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.kind === "row")).toBe(true);
  });

  it("preserves chronology — interleaved categories stay separate rows", () => {
    // read, search, read: three runs of length 1, so three rows in order.
    const calls = [tc("Read", "r1"), tc("Grep", "g1"), tc("Read", "r2")];
    const segments = segmentToolCalls(calls);

    expect(segments.map((s) => s.kind)).toEqual(["row", "row", "row"]);
  });

  it("splits adjacent runs of different groupable categories", () => {
    // read, read, search, search -> two chips, in order.
    const calls = [
      tc("Read", "r1"),
      tc("Read", "r2"),
      tc("Grep", "g1"),
      tc("Grep", "g2"),
    ];
    const segments = segmentToolCalls(calls);

    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe("run");
    expect(segments[1].kind).toBe("run");
    if (segments[0].kind === "run") expect(segments[0].category).toBe("read");
    if (segments[1].kind === "run") expect(segments[1].category).toBe("search");
  });

  it("folds a run that is bounded by high-signal rows on both sides", () => {
    const calls = [
      tc("Shell", "s1", { command: "echo a" }),
      tc("Read", "r1"),
      tc("Read", "r2"),
      tc("Shell", "s2", { command: "echo b" }),
    ];
    const segments = segmentToolCalls(calls);

    expect(segments.map((s) => s.kind)).toEqual(["row", "run", "row"]);
  });

  it("emits stable, distinct keys per segment", () => {
    const calls = [tc("Read", "r1"), tc("Read", "r2"), tc("Shell", "s1")];
    const segments = segmentToolCalls(calls);
    const keys = segments.map((s) => s.key);

    expect(new Set(keys).size).toBe(keys.length);
    // Run key is derived from its category + first call id; stable across runs.
    expect(segmentToolCalls(calls).map((s) => s.key)).toEqual(keys);
  });

  it("returns an empty list for no tool calls", () => {
    expect(segmentToolCalls([])).toEqual([]);
  });

  it("honours a registry runGroupable override", () => {
    // Force shell to fold; two adjacent shells then become one run chip.
    const dispose = registerToolPresenter(ToolKind.SHELL, {
      runGroupable: () => true,
    });
    try {
      const calls = [
        tc("Shell", "s1", { command: "echo a" }),
        tc("Shell", "s2", { command: "echo b" }),
      ];
      const segments = segmentToolCalls(calls);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe("run");
      if (segments[0].kind === "run") expect(segments[0].category).toBe("shell");
    } finally {
      dispose();
    }
  });
});
