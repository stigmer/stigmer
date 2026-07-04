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
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  InteractionMode,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { findStreamingPlan } from "../detect-streaming-plan";

function makeMessage(type: MessageType, content: string) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  return msg;
}

function makeExecution(opts: {
  phase?: ExecutionPhase;
  interactionMode?: InteractionMode;
  messages?: ReturnType<typeof makeMessage>[];
}): AgentExecution {
  const exec = create(AgentExecutionSchema);

  const spec = create(AgentExecutionSpecSchema);
  if (opts.interactionMode !== undefined) {
    const config = create(ExecutionConfigSchema);
    config.interactionMode = opts.interactionMode;
    spec.executionConfig = config;
  }
  exec.spec = spec;

  const status = create(AgentExecutionStatusSchema);
  status.phase = opts.phase ?? ExecutionPhase.EXECUTION_IN_PROGRESS;
  if (opts.messages) {
    status.messages = opts.messages;
  }
  exec.status = status;

  return exec;
}

/** A live Plan-mode execution with the given messages — the common case. */
function livePlanExecution(...messages: ReturnType<typeof makeMessage>[]) {
  return makeExecution({
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    interactionMode: InteractionMode.PLAN,
    messages,
  });
}

describe("findStreamingPlan — mode and phase gating", () => {
  const planMessage = makeMessage(MessageType.MESSAGE_AI, "# The Plan\n\nBody");

  it("detects a plan on a live Plan-mode execution", () => {
    const plan = findStreamingPlan(livePlanExecution(planMessage));
    expect(plan).toBeDefined();
    expect(plan!.messageIndex).toBe(0);
    expect(plan!.displayText).toBe("# The Plan\n\nBody");
  });

  it("returns undefined for null/undefined executions", () => {
    expect(findStreamingPlan(null)).toBeUndefined();
    expect(findStreamingPlan(undefined)).toBeUndefined();
  });

  it("returns undefined for an Agent-mode execution, even with a plan-shaped message", () => {
    const exec = makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      interactionMode: InteractionMode.AGENT,
      messages: [planMessage],
    });
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("returns undefined when no interaction mode is set", () => {
    const exec = makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [planMessage],
    });
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it.each([
    ExecutionPhase.EXECUTION_COMPLETED,
    ExecutionPhase.EXECUTION_FAILED,
    ExecutionPhase.EXECUTION_CANCELLED,
    ExecutionPhase.EXECUTION_TERMINATED,
  ])("returns undefined for terminal phase %s", (phase) => {
    const exec = makeExecution({
      phase,
      interactionMode: InteractionMode.PLAN,
      messages: [planMessage],
    });
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("detects during a non-terminal wait (approval gate mid-turn)", () => {
    const exec = makeExecution({
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      interactionMode: InteractionMode.PLAN,
      messages: [planMessage],
    });
    expect(findStreamingPlan(exec)).toBeDefined();
  });
});

describe("findStreamingPlan — candidate selection", () => {
  it("considers only the LAST content-bearing AI message", () => {
    // The earlier plan-shaped message is settled narration once a later AI
    // message exists — falling back to it would promote the wrong text.
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "# Early heading in narration"),
      makeMessage(MessageType.MESSAGE_AI, "Now let me check the tests."),
    );
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("skips trailing empty AI messages (extractFinalPlanText's rule)", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "# The Plan\n\nBody"),
      makeMessage(MessageType.MESSAGE_AI, "   "),
    );
    expect(findStreamingPlan(exec)?.messageIndex).toBe(0);
  });

  it("ignores non-AI message types when selecting the candidate", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "# The Plan\n\nBody"),
      makeMessage(MessageType.MESSAGE_THINKING, "hmm, one more thing"),
      makeMessage(MessageType.MESSAGE_TOOL, "tool output"),
    );
    expect(findStreamingPlan(exec)?.messageIndex).toBe(0);
  });

  it("returns undefined when there are no messages", () => {
    expect(findStreamingPlan(livePlanExecution())).toBeUndefined();
  });
});

describe("findStreamingPlan — H1 convention", () => {
  it("does not detect narration (no leading H1)", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "Let me explore the codebase."),
    );
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("does not detect a lone '#' first token (title not started yet)", () => {
    const exec = livePlanExecution(makeMessage(MessageType.MESSAGE_AI, "#"));
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("detects the moment the H1 gains its first title character", () => {
    const exec = livePlanExecution(makeMessage(MessageType.MESSAGE_AI, "# T"));
    expect(findStreamingPlan(exec)?.displayText).toBe("# T");
  });

  it("does not detect an H2-led message (## is a section, not a plan title)", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "## Notes\n\nSome section"),
    );
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("tolerates leading blank lines before the H1", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "\n\n# The Plan\n\nBody"),
    );
    expect(findStreamingPlan(exec)).toBeDefined();
  });
});

describe("findStreamingPlan — unterminated-fence tolerance", () => {
  it("unwraps an unterminated ```markdown fence", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```markdown\n# The Plan\n\nBody"),
    );
    expect(findStreamingPlan(exec)?.displayText).toBe("# The Plan\n\nBody");
  });

  it("unwraps an unterminated ```md fence", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```md\n# The Plan"),
    );
    expect(findStreamingPlan(exec)?.displayText).toBe("# The Plan");
  });

  it("unwraps an unterminated bare ``` fence (plan surfaces are markdown by contract)", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```\n# The Plan"),
    );
    expect(findStreamingPlan(exec)?.displayText).toBe("# The Plan");
  });

  it("strips the closing fence once it streams in as the final line", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```markdown\n# The Plan\n\nBody\n```"),
    );
    expect(findStreamingPlan(exec)?.displayText).toBe("# The Plan\n\nBody");
  });

  it("keeps a code-block fence inside the plan intact", () => {
    const content = "```markdown\n# The Plan\n\n```ts\nconst x = 1;\n```\n\nMore";
    const exec = livePlanExecution(makeMessage(MessageType.MESSAGE_AI, content));
    // Only the ENCLOSING fence is stripped; the ts block's fences are content.
    expect(findStreamingPlan(exec)?.displayText).toBe(
      "# The Plan\n\n```ts\nconst x = 1;\n```\n\nMore",
    );
  });

  it("never unwraps a fence with another language tag (a real code block)", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```python\n# not a heading, a comment"),
    );
    expect(findStreamingPlan(exec)).toBeUndefined();
  });

  it("does not detect a fenced message whose body has no H1", () => {
    const exec = livePlanExecution(
      makeMessage(MessageType.MESSAGE_AI, "```\nplain fenced text"),
    );
    expect(findStreamingPlan(exec)).toBeUndefined();
  });
});
