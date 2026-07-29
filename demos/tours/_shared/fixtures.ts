import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { RecentActivityEntry, UserMenuProps } from "@stigmer/react";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { samples, sampleDate } from "@stigmer/react/test";

/**
 * Org slug used across real-component tour chrome. Shown in the shell's org
 * indicator and passed to `SessionComposer` as its scope; no backend lookup
 * happens (the composer's list callbacks are inert in a demo).
 */
export const DEMO_ORG = "acme";

/**
 * The tour world's clock, as a `Date` — the reference instant the shells
 * pass to the real sidebar so relative stamps ("2h") and time buckets
 * ("Today"/"Yesterday") never read the live clock (scenar-cloud DD-006).
 */
export const DEMO_NOW = sampleDate();

/**
 * The depicted user, passed to the real `UserMenu` in the shell footers.
 * (The depicted-identity consolidation is tracked in the docs-revamp debt
 * register; these values match what the shells hardcoded before.)
 */
export const DEMO_USER: UserMenuProps["user"] = {
  name: "You",
  email: "you@acme.com",
};

/**
 * Recent-activity entries for the shells' Recents section — the same four
 * subjects the hand-drawn sidebar depicted, now as real entries whose
 * instants derive from the anchor: −2h/−4h land in "Today", −25h/−26h in
 * "Yesterday", and `formatRelativeTime` renders "2h"/"4h"/"1d"/"1d"
 * against {@link DEMO_NOW}. (Group labels bucket by the reader's local
 * midnight, so at extreme UTC offsets a −2h entry can legitimately read
 * "Yesterday" — deterministic per reader, plausible either way.)
 */
export const DEMO_RECENT_ACTIVITY: readonly RecentActivityEntry[] = [
  {
    id: "ses-recents-q3-launch",
    type: "session",
    subject: "Draft email copy for the Q3 launch",
    updatedAt: sampleDate(-2 * 3_600_000),
  },
  {
    id: "ses-recents-q2-report",
    type: "session",
    subject: "Q2 report analysis",
    updatedAt: sampleDate(-4 * 3_600_000),
  },
  {
    id: "ses-recents-meeting-notes",
    type: "session",
    subject: "Summarize meeting notes",
    updatedAt: sampleDate(-25 * 3_600_000),
  },
  {
    id: "ses-recents-refund-4821",
    type: "session",
    subject: "Refund request for order #ORD-4821",
    updatedAt: sampleDate(-26 * 3_600_000),
  },
];

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
