import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  ExecutionConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  InteractionMode,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems } from "../MessageThread";

function makeMessage(type: MessageType, content: string) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  return msg;
}

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  interactionMode?: InteractionMode;
  messages?: ReturnType<typeof makeMessage>[];
}): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const meta = create(ApiResourceMetadataSchema);
  meta.id = opts.id;
  exec.metadata = meta;

  const spec = create(AgentExecutionSpecSchema);
  spec.message = opts.specMessage ?? "test message";
  if (opts.interactionMode !== undefined) {
    const config = create(ExecutionConfigSchema);
    config.interactionMode = opts.interactionMode;
    spec.executionConfig = config;
  }
  exec.spec = spec;

  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_COMPLETED;
  if (opts.messages) {
    status.messages = opts.messages;
  }
  exec.status = status;

  return exec;
}

describe("buildThreadItems plan-completion variant", () => {
  it("emits plan-completion for COMPLETED Plan-mode execution", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Here is the plan")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeDefined();
    expect(planItem!.key).toBe("plan-completion");
  });

  it("does NOT emit plan-completion for COMPLETED Agent-mode execution", () => {
    const exec = makeExecution({
      id: "exec-agent",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.AGENT,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Done")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });

  it("does NOT emit plan-completion for COMPLETED execution with no interactionMode", () => {
    const exec = makeExecution({
      id: "exec-default",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Done")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });

  it("does NOT emit plan-completion for FAILED Plan-mode execution", () => {
    const exec = makeExecution({
      id: "exec-fail",
      phase: ExecutionPhase.EXECUTION_FAILED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Error")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });

  it("does NOT emit plan-completion for TERMINATED Plan-mode execution", () => {
    const exec = makeExecution({
      id: "exec-term",
      phase: ExecutionPhase.EXECUTION_TERMINATED,
      interactionMode: InteractionMode.PLAN,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });

  it("does NOT emit plan-completion when a Plan execution is actively streaming", () => {
    const exec = makeExecution({
      id: "exec-streaming",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Analyzing...")],
    });

    const items = buildThreadItems([], exec, null, false, undefined);
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });

  it("emits plan-completion only for the last execution in a multi-execution thread", () => {
    const agentExec = makeExecution({
      id: "exec-1",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.AGENT,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Built it")],
    });

    const planExec = makeExecution({
      id: "exec-2",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Here is the plan")],
    });

    const items = buildThreadItems(
      [agentExec, planExec],
      null,
      null,
      false,
      undefined,
    );
    const planItems = items.filter((i) => i.kind === "plan-completion");

    expect(planItems).toHaveLength(1);
  });

  it("does NOT emit plan-completion when last execution is Agent after a Plan", () => {
    const planExec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Here is the plan")],
    });

    const agentExec = makeExecution({
      id: "exec-impl",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.AGENT,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Implemented")],
    });

    const items = buildThreadItems(
      [planExec, agentExec],
      null,
      null,
      false,
      undefined,
    );
    const planItem = items.find((i) => i.kind === "plan-completion");

    expect(planItem).toBeUndefined();
  });
});
