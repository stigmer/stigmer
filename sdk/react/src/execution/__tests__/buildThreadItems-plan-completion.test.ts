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
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
  InteractionMode,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";

function makeMessage(type: MessageType, content: string) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  return msg;
}

function makePlanArtifact(executionId: string) {
  const artifact = create(ExecutionArtifactSchema);
  artifact.name = "plan.md";
  artifact.kind = ExecutionArtifactKind.FILE;
  artifact.storageKey = `artifacts/${executionId}/plan.md`;
  return artifact;
}

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  phase?: ExecutionPhase;
  interactionMode?: InteractionMode;
  messages?: ReturnType<typeof makeMessage>[];
  withPlanArtifact?: boolean;
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
  if (opts.withPlanArtifact) {
    status.artifacts = [makePlanArtifact(opts.id)];
  }
  exec.status = status;

  return exec;
}

function planItems(items: readonly ThreadItem[]) {
  return items.filter(
    (i): i is Extract<ThreadItem, { kind: "plan-completion" }> =>
      i.kind === "plan-completion",
  );
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
    const cards = planItems(items);

    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("exec-plan-plan-completion");
    expect(cards[0].isLatestPlan).toBe(true);
  });

  it("does NOT emit plan-completion for COMPLETED Agent-mode execution", () => {
    const exec = makeExecution({
      id: "exec-agent",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.AGENT,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Done")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(planItems(items)).toHaveLength(0);
  });

  it("does NOT emit plan-completion for COMPLETED execution with no interactionMode", () => {
    const exec = makeExecution({
      id: "exec-default",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Done")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(planItems(items)).toHaveLength(0);
  });

  it("does NOT emit plan-completion for FAILED Plan-mode execution", () => {
    const exec = makeExecution({
      id: "exec-fail",
      phase: ExecutionPhase.EXECUTION_FAILED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Error")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(planItems(items)).toHaveLength(0);
  });

  it("does NOT emit plan-completion for TERMINATED Plan-mode execution", () => {
    const exec = makeExecution({
      id: "exec-term",
      phase: ExecutionPhase.EXECUTION_TERMINATED,
      interactionMode: InteractionMode.PLAN,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(planItems(items)).toHaveLength(0);
  });

  it("does NOT emit plan-completion when a Plan execution is actively streaming", () => {
    const exec = makeExecution({
      id: "exec-streaming",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Analyzing...")],
    });

    const items = buildThreadItems([], exec, null, false, undefined);

    expect(planItems(items)).toHaveLength(0);
  });

  it("emits one card, attached to the plan segment, for [agent, plan]", () => {
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
    const cards = planItems(items);

    expect(cards).toHaveLength(1);
    expect(cards[0].isLatestPlan).toBe(true);
  });

  it("keeps the plan card (with build authority) after a later Agent turn", () => {
    // The plan is still the thread's latest plan — an intervening Agent turn
    // must not strip the review card or its Build action.
    const planExec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Here is the plan")],
      withPlanArtifact: true,
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
    const cards = planItems(items);

    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("exec-plan-plan-completion");
    expect(cards[0].isLatestPlan).toBe(true);
    // The card closes the plan's own segment — it precedes the agent turn.
    const cardIndex = items.indexOf(cards[0]);
    const agentSpecIndex = items.findIndex((i) => i.key === "exec-impl-spec");
    expect(cardIndex).toBeLessThan(agentSpecIndex);
  });

  it("emits a card per plan; only the newest carries isLatestPlan", () => {
    const planA = makeExecution({
      id: "exec-plan-a",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan A")],
      withPlanArtifact: true,
    });
    const planB = makeExecution({
      id: "exec-plan-b",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan B")],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([planA, planB], null, null, false, undefined);
    const cards = planItems(items);

    expect(cards).toHaveLength(2);
    expect(cards[0].key).toBe("exec-plan-a-plan-completion");
    expect(cards[0].isLatestPlan).toBe(false);
    expect(cards[1].key).toBe("exec-plan-b-plan-completion");
    expect(cards[1].isLatestPlan).toBe(true);
  });

  it("skips a superseded plan that never published an artifact", () => {
    // No artifact and no build authority → the card would be an empty shell.
    const planA = makeExecution({
      id: "exec-plan-a",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan A")],
      withPlanArtifact: false,
    });
    const planB = makeExecution({
      id: "exec-plan-b",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Plan B")],
      withPlanArtifact: false,
    });

    const items = buildThreadItems([planA, planB], null, null, false, undefined);
    const cards = planItems(items);

    // Only the latest (artifact-less) plan renders — as the fallback CTA.
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("exec-plan-b-plan-completion");
    expect(cards[0].isLatestPlan).toBe(true);
    expect(cards[0].planArtifact).toBeUndefined();
  });

  it("carries the plan artifact on the item when published", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Here is the plan")],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const card = planItems(items)[0];

    expect(card.planArtifact?.name).toBe("plan.md");
  });
});

describe("buildThreadItems plan-message collapse (artifact published)", () => {
  function messageItems(items: readonly ThreadItem[]) {
    return items.filter(
      (i): i is Extract<ThreadItem, { kind: "message" }> =>
        i.kind === "message",
    );
  }

  it("removes the plan message from the thread — the card is the turn's sole plan representation", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Let me look around first."),
        makeMessage(MessageType.MESSAGE_AI, "# The Plan\n\n1. Do the thing"),
      ],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    // The opening narration stays; the plan message (m1) is collapsed.
    const keys = messageItems(items).map((i) => i.key);
    expect(keys).toContain("exec-plan-m0");
    expect(keys).not.toContain("exec-plan-m1");
    expect(planItems(items)).toHaveLength(1);
  });

  it("lifts the plan's leading H1 onto the card as its title", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "# Refactor auth\n\nSteps…"),
      ],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(planItems(items)[0].planTitle).toBe("Refactor auth");
  });

  it("extracts the title through a plan-scoped enclosing fence (bare fence included)", () => {
    // Same unwrap the document renderers apply, so card and plan tab agree.
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "```\n# Fenced Plan\n\nBody\n```"),
      ],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(planItems(items)[0].planTitle).toBe("Fenced Plan");
  });

  it("leaves the title undefined when the plan has no leading H1", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Just prose, no title")],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(planItems(items)[0].planTitle).toBeUndefined();
  });

  it("never stamps isPlanDocument when the message collapsed into the card", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "# The Plan")],
      withPlanArtifact: true,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    expect(
      messageItems(items).filter((i) => i.isPlanDocument === true),
    ).toHaveLength(0);
  });

  it("keeps the plan message inline while streaming (no artifact yet)", () => {
    const exec = makeExecution({
      id: "exec-live",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "# Draft so far")],
    });

    const items = buildThreadItems([], exec, null, false, undefined);
    expect(messageItems(items).map((i) => i.key)).toContain("exec-live-m0");
  });
});

describe("buildThreadItems plan-document stamping (no-artifact fallback)", () => {
  function planDocumentItems(items: readonly ThreadItem[]) {
    return items.filter(
      (i): i is Extract<ThreadItem, { kind: "message" }> =>
        i.kind === "message" && i.isPlanDocument === true,
    );
  }

  it("stamps the last AI message with content of a completed Plan execution", () => {
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "Let me look around first."),
        makeMessage(MessageType.MESSAGE_AI, "# The Plan\n\n1. Do the thing"),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const docs = planDocumentItems(items);

    expect(docs).toHaveLength(1);
    expect(docs[0].key).toBe("exec-plan-m1");
  });

  it("does not stamp any message on an Agent-mode execution", () => {
    const exec = makeExecution({
      id: "exec-agent",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.AGENT,
      messages: [makeMessage(MessageType.MESSAGE_AI, "# Not a plan")],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);

    expect(planDocumentItems(items)).toHaveLength(0);
  });

  it("does not stamp while the Plan execution is still streaming", () => {
    const exec = makeExecution({
      id: "exec-live",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      interactionMode: InteractionMode.PLAN,
      messages: [makeMessage(MessageType.MESSAGE_AI, "Draft so far...")],
    });

    const items = buildThreadItems([], exec, null, false, undefined);

    expect(planDocumentItems(items)).toHaveLength(0);
  });

  it("skips trailing empty AI messages when selecting the plan message", () => {
    // Mirrors the runner's extractFinalPlanText: the plan is the last AI
    // message WITH content, not merely the last AI message.
    const exec = makeExecution({
      id: "exec-plan",
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      interactionMode: InteractionMode.PLAN,
      messages: [
        makeMessage(MessageType.MESSAGE_AI, "# The Plan"),
        makeMessage(MessageType.MESSAGE_AI, "   "),
      ],
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const docs = planDocumentItems(items);

    expect(docs).toHaveLength(1);
    expect(docs[0].key).toBe("exec-plan-m0");
  });
});
