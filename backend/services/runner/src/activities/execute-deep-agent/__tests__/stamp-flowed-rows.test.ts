/**
 * Unit tests for the deep-agent turn-boundary flowed-row stamping
 * (`stamp-flowed-rows.ts`), with emphasis on the sub-agent path added by the
 * DD-24 follow-up: sub-agent edit rows fold into the parent turn's change set,
 * so they carry the parent change set id, scoped to this turn by tool-call-id
 * novelty (they lack the already-stamped/hidden shields the top-level pass has).
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { collectSubAgentToolCallIds } from "../../../shared/tool-row.js";
import {
  stampFlowedFileEditRows,
  stampFlowedSubAgentFileEditRows,
} from "../stamp-flowed-rows.js";

const CHANGE_SET_ID = "exec-1:0";

/** A streamed (COMPLETED) file-edit tool call, as the deep-agent would record. */
function editMessage(id: string, path: string, name = "write_file"): AgentMessage {
  return create(AgentMessageSchema, {
    type: 1, // MESSAGE_AI
    toolCalls: [
      create(ToolCallSchema, {
        id,
        name,
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        args: { file_path: path, content: "x" },
      }),
    ],
  });
}

function subAgent(subId: string, ...messages: AgentMessage[]) {
  return create(SubAgentExecutionSchema, { id: subId, name: "code_editor", messages });
}

describe("stampFlowedFileEditRows (deep-agent)", () => {
  it("stamps a flowed write/delete row and leaves a non-file row untouched", () => {
    const write = editMessage("tc-1", "src/a.ts", "write_file");
    const shell = create(AgentMessageSchema, {
      type: 1,
      toolCalls: [create(ToolCallSchema, { id: "tc-2", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED })],
    });

    stampFlowedFileEditRows([write, shell], CHANGE_SET_ID);

    expect(write.toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
    expect(shell.toolCalls[0].fileChangeSetId).toBe("");
  });

  it("skips a tool-call id in skipToolCallIds (current-turn scoping)", () => {
    const prior = editMessage("tc-prior", "src/old.ts");
    const current = editMessage("tc-current", "src/new.ts");

    stampFlowedFileEditRows([prior, current], CHANGE_SET_ID, new Set(["tc-prior"]));

    expect(prior.toolCalls[0].fileChangeSetId).toBe(""); // skipped
    expect(current.toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
  });

  it("never overwrites an already-stamped row", () => {
    const row = editMessage("tc-1", "src/a.ts");
    row.toolCalls[0].fileChangeSetId = "exec-1:prior";

    stampFlowedFileEditRows([row], CHANGE_SET_ID);

    expect(row.toolCalls[0].fileChangeSetId).toBe("exec-1:prior");
  });
});

describe("stampFlowedSubAgentFileEditRows (deep-agent)", () => {
  it("stamps a current-turn sub-agent's edit row with the parent change set id", () => {
    const sub = subAgent("sa-1", editMessage("sa-tc-1", "src/sub.ts"));

    stampFlowedSubAgentFileEditRows([sub], CHANGE_SET_ID, new Set());

    expect(sub.messages[0].toolCalls[0].fileChangeSetId).toBe(CHANGE_SET_ID);
  });

  it("stamps a fresh continuation row of a spanning sub-agent, not its prior row", () => {
    // A sub-agent that paused on an internal tool gate spans invocations: its
    // sub-agent id and its earlier row pre-exist on resume, but the continuation
    // edit row carries a fresh tool-call id and belongs to the completing turn.
    const priorRow = editMessage("sa-tc-old", "src/before.ts");
    const spanning = subAgent("sa-span", priorRow);
    const priorToolCallIds = collectSubAgentToolCallIds([spanning]); // {sa-tc-old}

    // On resume the same sub-agent appends a new edit row.
    spanning.messages.push(editMessage("sa-tc-new", "src/after.ts"));

    stampFlowedSubAgentFileEditRows([spanning], "exec-1:1", priorToolCallIds);

    expect(spanning.messages[0].toolCalls[0].fileChangeSetId).toBe(""); // prior row untouched
    expect(spanning.messages[1].toolCalls[0].fileChangeSetId).toBe("exec-1:1"); // continuation stamped
  });

  it("withholds content for a sub-agent write to a tracked secret-like path (DD-12 D4 inherited)", () => {
    const sub = subAgent("sa-1", editMessage("sa-tc-secret", "config/credentials.json"));

    stampFlowedSubAgentFileEditRows([sub], CHANGE_SET_ID, new Set());

    const row = sub.messages[0].toolCalls[0];
    expect(row.fileChangeSetId).toBe(CHANGE_SET_ID); // stamped (path visible)
    // stampFileEditRow normalizes the withheld row to `{ path }` (see tool-row.ts).
    expect(row.args).toEqual({ path: "config/credentials.json" }); // body withheld
  });

  it("does nothing for no sub-agents", () => {
    expect(() => stampFlowedSubAgentFileEditRows([], CHANGE_SET_ID, new Set())).not.toThrow();
  });
});
