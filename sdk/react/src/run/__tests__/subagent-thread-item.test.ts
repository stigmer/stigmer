import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import { SubAgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/subagent_pb";
import {
  RunPhase,
  MessageType,
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { buildThreadItems } from "../MessageThread";

/**
 * Guards the correlation that makes a delegated sub-agent appear in the live
 * thread: a parent MESSAGE_AI carrying a "task" tool call becomes a "sub-agent"
 * thread item only when a SubAgentRun with the same id is present in
 * status.sub_agent_runs.
 *
 * This is the UI side of the cursor mid-stream visibility fix. Before the fix,
 * the runner streamed an empty sub_agent_runs list while the parent ran,
 * so the task tool call had no match — it was hidden AND no card rendered (the
 * "idle screen"). Persisting the IN_PROGRESS sub-agent mid-stream makes the
 * match succeed, so the card renders live.
 */

function makeAiWithTaskCall(taskCallId: string): ReturnType<typeof create<typeof AgentMessageSchema>> {
  const msg = create(AgentMessageSchema);
  msg.type = MessageType.MESSAGE_AI;
  msg.content = "Delegating to the researcher.";
  const tc = create(ToolCallSchema);
  tc.id = taskCallId;
  tc.name = "task";
  msg.toolCalls = [tc];
  return msg;
}

function makeSubAgent(id: string, status: SubAgentStatus): ReturnType<typeof create<typeof SubAgentRunSchema>> {
  const sa = create(SubAgentRunSchema);
  sa.id = id;
  sa.name = "Research renewable energy";
  sa.subject = "Research renewable energy";
  sa.status = status;
  return sa;
}

function makeExecution(opts: {
  id: string;
  phase: RunPhase;
  messages: ReturnType<typeof create<typeof AgentMessageSchema>>[];
  subAgents?: ReturnType<typeof create<typeof SubAgentRunSchema>>[];
}): AgentRun {
  const exec = create(AgentRunSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id;
  exec.metadata = meta;

  const spec = create(AgentRunSpecSchema);
  spec.message = "Please delegate to the researcher.";
  exec.spec = spec;

  const status = create(AgentRunStatusSchema);
  status.phase = opts.phase;
  status.messages = opts.messages;
  if (opts.subAgents) {
    status.subAgentRuns = opts.subAgents;
  }
  exec.status = status;

  return exec;
}

describe("buildThreadItems sub-agent correlation", () => {
  it("renders an IN_PROGRESS sub-agent as a sub-agent item while the parent is still running", () => {
    const taskId = "tool_live_1";
    const exec = makeExecution({
      id: "exec-live",
      phase: RunPhase.RUN_IN_PROGRESS,
      messages: [makeAiWithTaskCall(taskId)],
      subAgents: [makeSubAgent(taskId, SubAgentStatus.SUB_AGENT_IN_PROGRESS)],
    });

    const items = buildThreadItems([exec], exec, null, false, undefined);

    const subItem = items.find((i) => i.kind === "sub-agent");
    expect(subItem).toBeDefined();
    if (subItem?.kind !== "sub-agent") throw new Error("expected sub-agent item");
    expect(subItem.subAgentRun.id).toBe(taskId);
    expect(subItem.subAgentRun.status).toBe(
      SubAgentStatus.SUB_AGENT_IN_PROGRESS,
    );
    expect(subItem.key).toBe(`sa-${taskId}`);

    // The "task" tool call must never surface as a normal tool row — it is
    // represented by the sub-agent card.
    const toolGroups = items.filter((i) => i.kind === "tool-group");
    for (const g of toolGroups) {
      if (g.kind !== "tool-group") continue;
      expect(g.toolCalls.some((tc) => tc.name === "task")).toBe(false);
    }
  });

  it("renders a COMPLETED sub-agent as a sub-agent item", () => {
    const taskId = "tool_done_1";
    const exec = makeExecution({
      id: "exec-done",
      phase: RunPhase.RUN_COMPLETED,
      messages: [makeAiWithTaskCall(taskId)],
      subAgents: [makeSubAgent(taskId, SubAgentStatus.SUB_AGENT_COMPLETED)],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    const subItem = items.find((i) => i.kind === "sub-agent");
    expect(subItem).toBeDefined();
    if (subItem?.kind !== "sub-agent") throw new Error("expected sub-agent item");
    expect(subItem.subAgentRun.status).toBe(
      SubAgentStatus.SUB_AGENT_COMPLETED,
    );
  });

  it("documents the pre-fix invisible state: a task call with no matching sub-agent produces neither a card nor a tool row", () => {
    // This is exactly the buggy cursor mid-stream state the runner fix
    // eliminates: the task tool call exists in messages, but
    // sub_agent_runs is still empty, so no sub-agent card renders and
    // the task tool call is suppressed — the "nothing is happening" screen.
    const taskId = "tool_orphan_1";
    const exec = makeExecution({
      id: "exec-orphan",
      phase: RunPhase.RUN_IN_PROGRESS,
      messages: [makeAiWithTaskCall(taskId)],
      subAgents: [],
    });

    const items = buildThreadItems([exec], exec, null, false, undefined);

    expect(items.some((i) => i.kind === "sub-agent")).toBe(false);
    const toolGroups = items.filter((i) => i.kind === "tool-group");
    for (const g of toolGroups) {
      if (g.kind !== "tool-group") continue;
      expect(g.toolCalls.some((tc) => tc.name === "task")).toBe(false);
    }
  });
});
