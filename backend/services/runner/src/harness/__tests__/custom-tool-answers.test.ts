/**
 * Pins the runtime's door for the host app's answers to its own tools
 * (`custom-tool-answers.ts`) and the reinvocation's reading of them
 * (`turn-context.ts` `waitingCustomAnswers`):
 *
 *  - an answer is read by the call it names, its text blocks joined, its
 *    error mark kept; the first answer to a call stands; an answer to
 *    another run's call never lands; a block other than text is skipped;
 *  - the turn is handed only the answers to calls still waiting as the
 *    host's, never one for an approval's row or a delivered call;
 *  - the reinvocation reads the answers in its one read, and an engine's
 *    call of a custom tool counts as the engine's own write.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { CUSTOM_TOOL_ANSWER_EVENT_TYPES, NO_CUSTOM_TOOL_ANSWERS, customToolAnswersOf } from "../custom-tool-answers.js";
import { ENGINE_EVENT_TYPES, REINVOCATION_EVENT_TYPES, waitingCustomAnswers } from "../turn-context.js";
import { toolUseEventId } from "../events/ids.js";
import { AgentMessageSchema, ToolCallSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType, ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const RUN = "run_01custom";

function answer(runId: string, callId: string, content: { type: string; text: string }[], isError = false): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: { case: "userCustomToolResult", value: { id: `sevt_ctr_${callId}`, customToolUseId: toolUseEventId(runId, callId), content, isError } },
  });
}

describe("customToolAnswersOf", () => {
  it("reads each answer by its call: text joined, the error mark kept, the first answer standing", () => {
    const { results } = customToolAnswersOf(RUN, [
      answer(RUN, "call_ok", [{ type: "text", text: "registered " }, { type: "text", text: "as svc_payments" }]),
      answer(RUN, "call_err", [{ type: "text", text: "closed" }], true),
      answer(RUN, "call_ok", [{ type: "text", text: "a second answer" }]),
    ]);
    expect([...results]).toEqual([
      ["call_ok", { text: "registered as svc_payments", isError: false }],
      ["call_err", { text: "closed", isError: true }],
    ]);
  });

  it("never takes another run's answer, and skips a block that is not text", () => {
    const { results } = customToolAnswersOf(RUN, [
      answer("run_other", "call_ok", [{ type: "text", text: "not ours" }]),
      answer(RUN, "call_img", [{ type: "image", text: "" }, { type: "text", text: "the words" }]),
    ]);
    expect([...results]).toEqual([["call_img", { text: "the words", isError: false }]]);
    expect(NO_CUSTOM_TOOL_ANSWERS.results.size).toBe(0);
  });

  it("is part of the reinvocation's one read, and a custom call is the engine's own write", () => {
    for (const type of CUSTOM_TOOL_ANSWER_EVENT_TYPES) expect(REINVOCATION_EVENT_TYPES).toContain(type);
    expect(REINVOCATION_EVENT_TYPES).toContain("agent.custom_tool_use");
    expect(ENGINE_EVENT_TYPES).toContain("agent.custom_tool_use");
    expect(ENGINE_EVENT_TYPES).not.toContain("user.custom_tool_result");
  });
});

describe("waitingCustomAnswers", () => {
  it("hands the turn the answers to the host's calls still waiting, and no other", () => {
    const rows = {
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [
            create(ToolCallSchema, { id: "call_waiting", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL, customTool: true }),
            create(ToolCallSchema, { id: "call_approval", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL }),
            create(ToolCallSchema, { id: "call_delivered", status: ToolCallStatus.TOOL_CALL_COMPLETED, customTool: true }),
          ],
        }),
      ],
    };
    const results = new Map([
      ["call_waiting", { text: "a", isError: false }],
      ["call_approval", { text: "b", isError: false }],
      ["call_delivered", { text: "c", isError: false }],
    ]);
    expect([...waitingCustomAnswers(rows, results)]).toEqual([["call_waiting", { text: "a", isError: false }]]);
  });
});
