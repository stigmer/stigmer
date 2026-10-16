import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { RecentActivityEntry, UserMenuProps } from "@stigmer/react-sdk";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react-sdk";
import { samples, sampleDate } from "@stigmer/react-sdk/test";
import type { Turn } from "@stigmer/client";

/**
 * Org slug used across real-component tour chrome. Shown in the shell's org
 * indicator and passed to `SessionComposer` as its scope; no backend lookup
 * happens (the composer's list callbacks are inert in a demo).
 */
export const DEMO_ORG = "acme";

/**
 * The same organization's id, as the pre-registered organization fixture
 * (`stigmer-preview.tsx`) carries it. The API takes an organization by slug
 * or id; a tour that must tell two reads of one organization apart names
 * it once each way.
 */
export const DEMO_ORG_ID = samples.organization().metadata?.id ?? DEMO_ORG;

/**
 * The tour world's clock, as a `Date` — the reference instant the shells
 * pass to the real sidebar so relative stamps ("2h") and time buckets
 * ("Today"/"Yesterday") never read the live clock (the
 * fixture-determinism rule, demos/README.md).
 */
export const DEMO_NOW = sampleDate();

/**
 * The depicted user, passed to the real `UserMenu` in the shell footers.
 * These values match what the shells hardcoded before.
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
    subject: "Draft email copy for the Q3 launch",
    updatedAt: sampleDate(-2 * 3_600_000),
  },
  {
    id: "ses-recents-q2-report",
    subject: "Q2 report analysis",
    updatedAt: sampleDate(-4 * 3_600_000),
  },
  {
    id: "ses-recents-meeting-notes",
    subject: "Summarize meeting notes",
    updatedAt: sampleDate(-25 * 3_600_000),
  },
  {
    id: "ses-recents-refund-4821",
    subject: "Refund request for order #ORD-4821",
    updatedAt: sampleDate(-26 * 3_600_000),
  },
];

/**
 * A depicted conversation as the session surface reads it: its turns, the
 * session's events folded, and the runs that carry each turn's lifecycle
 * and spec. `MessageThread` renders the turns; the runs supply what the
 * events do not (the message's mode and attachments, the phase the panel
 * facets read).
 */
export interface DemoConversation {
  readonly turns: readonly Turn[];
  readonly runs: readonly Run[];
}

/**
 * Fold one turn's session events (built with the `samples.*Event`
 * builders, all on the demo run) into a {@link DemoConversation}, beside
 * the demo run at `phase` started with the turn's own message — the run's
 * `spec.message` is what the thread shows as the person's bubble, so it
 * must match the events' `user.message`.
 *
 * Pass the phase the events end on: `RUN_IN_PROGRESS` (the default) for a
 * mid-conversation frame, `RUN_COMPLETED` for a finished one. Both are
 * presentational — nothing is fetched.
 */
export function conversation(
  events: readonly SessionEvent[],
  phase: RunPhase = RunPhase.RUN_IN_PROGRESS,
): DemoConversation {
  const fold = samples.fold(events);
  return {
    turns: fold.turns,
    runs: [samples.run({ phase, message: fold.turns[0]?.userMessage?.text ?? "" })],
  };
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
