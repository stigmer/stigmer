import {
  RunPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { RunArtifact } from "@stigmer/protos/ai/stigmer/agentic/run/v1/artifact_pb";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";

export const DEMO_ORG = "demo-org";

const noop = () => {};

export const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  clearLocal: noop,
  toInput: () => [],
  hasEntries: false,
};

/**
 * Build a run snapshot where the first human message goes into
 * `spec.message` and the remaining messages go into `status.messages`.
 *
 * `MessageThread` synthesizes a human bubble from `spec.message`
 * automatically, so this split avoids rendering it twice.
 */
export function snapshot(
  msgs: AgentMessage[],
  phase: RunPhase = RunPhase.RUN_IN_PROGRESS,
  artifacts?: RunArtifact[],
): Run {
  const firstHumanIdx = msgs.findIndex(
    (m) => m.type === MessageType.MESSAGE_HUMAN,
  );
  const specMessage =
    firstHumanIdx >= 0 ? msgs[firstHumanIdx].content : "";
  const statusMessages =
    firstHumanIdx >= 0
      ? [...msgs.slice(0, firstHumanIdx), ...msgs.slice(firstHumanIdx + 1)]
      : msgs;

  const exec = samples.run({
    phase,
    messages: statusMessages,
    artifacts,
  });
  exec.spec!.message = specMessage;
  return exec;
}
