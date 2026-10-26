/**
 * Pins the one Claude capability that is a predicate rather than a fact
 * (`claude-capabilities.ts` `claudeRowAwaitsGate`): which rows the session
 * event emitter holds back from the log until they settle.
 *
 * Why it matters: the engine streams a call before the gate decides it. A
 * row the gate then pauses must reach the log as an ask, beside its
 * `stigmer.permission.asked`, or the resumed run seeds no waiting call and
 * the person's answer reaches nothing; and a row written as it opens holds
 * none of its arguments yet. A helper's start is never held, so its own
 * thread reaches the log as it works.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { ToolCallSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { CLAUDE_CAPABILITIES, claudeRowAwaitsGate } from "../claude-capabilities.js";

const row = (name: string, status: ToolCallStatus) => create(ToolCallSchema, { id: "toolu_1", name, status });

describe("claudeRowAwaitsGate", () => {
  it("holds a call until it settles, whatever it is, and is the capability the emitter reads", () => {
    for (const name of ["Bash", "Write", "Read", "mcp__docs__drop"]) {
      expect(claudeRowAwaitsGate(row(name, ToolCallStatus.TOOL_CALL_PENDING)), name).toBe(true);
      expect(claudeRowAwaitsGate(row(name, ToolCallStatus.TOOL_CALL_RUNNING)), name).toBe(true);
    }
    for (const status of [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, ToolCallStatus.TOOL_CALL_COMPLETED, ToolCallStatus.TOOL_CALL_FAILED, ToolCallStatus.TOOL_CALL_SKIPPED]) {
      expect(claudeRowAwaitsGate(row("Bash", status)), ToolCallStatus[status]).toBe(false);
    }
    expect(CLAUDE_CAPABILITIES.boundaryRewritesRow).toBe(claudeRowAwaitsGate);
  });

  it("never holds a helper's start, so the helper's thread reaches the log as it works", () => {
    expect(claudeRowAwaitsGate(row("Agent", ToolCallStatus.TOOL_CALL_RUNNING))).toBe(false);
  });
});
