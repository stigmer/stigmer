import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";

/**
 * Org slug used across real-component tour chrome. Shown in the shell's org
 * indicator and passed to `SessionComposer` as its scope; no backend lookup
 * happens (the composer's list callbacks are inert in a demo).
 */
export const DEMO_ORG = "acme";

/**
 * Build an execution snapshot where the first human message goes into
 * `spec.message` and the rest into `status.messages`. `MessageThread`
 * synthesizes the human bubble from `spec.message`, so this split avoids
 * rendering it twice.
 *
 * The default `EXECUTION_IN_PROGRESS` phase suits mid-conversation frames
 * (`MessageThread`/`ExecutionProgress` render it as a "working" indicator
 * without fetching anything — they are presentational); pass
 * `EXECUTION_COMPLETED` for a finished conversation.
 */
export function snapshot(
  msgs: AgentMessage[],
  phase: ExecutionPhase = ExecutionPhase.EXECUTION_IN_PROGRESS,
  artifacts?: ExecutionArtifact[],
): AgentExecution {
  const firstHumanIdx = msgs.findIndex((m) => m.type === MessageType.MESSAGE_HUMAN);
  const specMessage = firstHumanIdx >= 0 ? msgs[firstHumanIdx].content : "";
  const statusMessages =
    firstHumanIdx >= 0
      ? [...msgs.slice(0, firstHumanIdx), ...msgs.slice(firstHumanIdx + 1)]
      : msgs;

  const exec = samples.agentExecution({ phase, messages: statusMessages, artifacts });
  exec.spec!.message = specMessage;
  return exec;
}

const noop = () => {};

/**
 * An empty workspace for `SessionComposer` in a demo. The composer takes the
 * workspace-entries controller as a prop rather than fetching it, so a static,
 * empty, inert implementation is all a tour needs — there is nothing to add,
 * remove, or submit in a playback.
 */
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
