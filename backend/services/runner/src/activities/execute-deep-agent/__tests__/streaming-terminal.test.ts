import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  TOOL_CALL_LIMIT_ERROR_PREFIX,
  handleRecursionLimit,
} from "../streaming-terminal.js";
import type { ExecutionStatusWriter } from "../../../shared/execution-status-writer.js";

function writerWith(status = create(AgentExecutionStatusSchema, {})): ExecutionStatusWriter {
  return { currentStatus: status } as ExecutionStatusWriter;
}

describe("handleRecursionLimit", () => {
  it("terminates with work saved and a continue prompt", () => {
    const writer = writerWith();

    const result = handleRecursionLimit(writer, 42, [], []);

    expect(writer.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(writer.currentStatus.completedAt).toBeDefined();
    expect(result.terminalStatus).toBeDefined();
  });

  it("pins the cross-repo error prefix that Stigmer Cloud's channel delivery matches on", () => {
    // ChannelReplyExtractor (stigmer-cloud) distinguishes budget-limit
    // TERMINATED from other causes by this prefix — there is no structured
    // termination reason on AgentExecutionStatus. A reword here silently
    // downgrades channel users from the friendly limit copy to generic
    // error copy, so the prefix is pinned on both sides.
    expect(TOOL_CALL_LIMIT_ERROR_PREFIX).toBe("Agent reached the tool-call limit");

    const writer = writerWith();
    handleRecursionLimit(writer, 7, [], []);

    expect(writer.currentStatus.error).toMatch(/^Agent reached the tool-call limit/);
    expect(writer.currentStatus.error).toContain("Send another message to continue.");
  });
});
