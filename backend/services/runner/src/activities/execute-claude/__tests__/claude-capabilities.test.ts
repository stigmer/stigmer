/**
 * Pins the one Claude capability that is a predicate rather than a fact
 * (`claude-capabilities.ts` `claudeRowAwaitsGate`): which rows the session
 * event emitter holds back from the log until the gate lets them run.
 *
 * Why it matters: the engine streams a call before the gate decides it. A
 * row the gate then pauses must reach the log as an ask, beside its
 * `stigmer.permission.asked`, or the resumed run seeds no waiting call and
 * the person's answer reaches nothing; and a row written as it opens holds
 * none of its arguments yet. Such a row is PENDING (`translator.ts`). A row
 * the gate let run is RUNNING and reaches the log at once, so a long call
 * is in the log while it runs and a runner lost mid-call leaves it there
 * (stigmer#2614). A helper's start is never held, so its own thread reaches
 * the log as it works.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { ToolCallSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { CLAUDE_CAPABILITIES, claudeRowAwaitsGate } from "../claude-capabilities.js";

const row = (name: string, status: ToolCallStatus) => create(ToolCallSchema, { id: "toolu_1", name, status });

describe("claudeRowAwaitsGate", () => {
  it("holds a call while its gate is undecided, whatever it is, releases it once the gate lets it run, and is the capability the emitter reads", () => {
    for (const name of ["Bash", "Write", "Read", "mcp__docs__drop"]) {
      expect(claudeRowAwaitsGate(row(name, ToolCallStatus.TOOL_CALL_PENDING)), name).toBe(true);
      expect(claudeRowAwaitsGate(row(name, ToolCallStatus.TOOL_CALL_RUNNING)), `${name} running`).toBe(false);
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
