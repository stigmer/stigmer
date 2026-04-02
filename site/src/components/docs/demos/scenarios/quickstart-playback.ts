/**
 * Quickstart scenario: a timed playback showing a basic conversation
 * with the implicit assistant agent.
 *
 * The AI gives generic answers because no Skill is attached — this
 * demonstrates the quickstart aha moment ("I have an AI agent I can
 * call from my code") while setting up the bridge to "Your First Skill"
 * ("the answer was generic; let's fix that").
 */

import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { samples } from "@stigmer/react/demo";
import type { ScenarioStep } from "../ScenarioPlayer";

const user1 = samples.humanMessage(
  "What is your return policy for defective items?",
);

const ai1 = samples.aiMessage(
  "I'd be happy to help, but I don't have specific information about your " +
    "company's return policy. Generally, many companies accept returns for " +
    "defective items within a certain timeframe. Could you share which " +
    "company's policy you're asking about?",
);

const user2 = samples.humanMessage(
  "Do you cover return shipping for defective items?",
);

const ai2 = samples.aiMessage(
  "I don't have access to your specific shipping policies. Return shipping " +
    "coverage varies by company — some cover it for defective items while " +
    "others require the customer to pay. I'd recommend checking with your " +
    "support team for the exact policy.",
);

/**
 * Build a snapshot where the first human message becomes `spec.message`
 * and only the remaining messages go into `status.messages`. This avoids
 * duplication since `MessageThread` synthesizes a human bubble from
 * `spec.message` automatically.
 */
function snapshot(...msgs: AgentMessage[]): AgentExecution {
  const firstHumanIdx = msgs.findIndex(
    (m) => m.type === MessageType.MESSAGE_HUMAN,
  );
  const specMessage =
    firstHumanIdx >= 0 ? msgs[firstHumanIdx].content : "";
  const statusMessages =
    firstHumanIdx >= 0
      ? [...msgs.slice(0, firstHumanIdx), ...msgs.slice(firstHumanIdx + 1)]
      : msgs;

  const exec = samples.agentExecution({
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    messages: statusMessages,
  });
  exec.spec!.message = specMessage;
  return exec;
}

export const quickstartPlaybackSteps: ScenarioStep<AgentExecution>[] = [
  { delayMs: 0, data: snapshot(user1) },
  { delayMs: 2000, data: snapshot(user1, ai1) },
  { delayMs: 2500, data: snapshot(user1, ai1, user2) },
  { delayMs: 2000, data: snapshot(user1, ai1, user2, ai2) },
];
