"use client";

/**
 * The notice docked above the composer when a conversation runs an older
 * version of its agent than the agent's author last saved, with the one
 * control that moves it.
 *
 * A conversation keeps the agent version it started on, so an author's
 * save never changes it under the person in it. This strip says so and
 * offers "Update", which moves the conversation to the current version
 * (an update of the session's agent reference to `latest`); until the
 * person presses it, nothing changes. When the current version declares
 * keys it reads from the person's My vault, the notice names
 * them, so the update hands over nothing unannounced (the line the
 * composer shows before a conversation's first message, for the version
 * the update moves to). `SessionViewer` renders it only
 * when `useSessionAgentVersion` reports the conversation outdated, and
 * never for a guest or an observer, who cannot change the session.
 *
 * Pinned by `__tests__/AgentVersionNotice.test.tsx`.
 */

import { getUserMessage } from "@stigmer/client";
import { Button } from "../button/Button.js";
import { ComposerStrip } from "./ComposerStrip.js";

/** Props for {@link AgentVersionNotice}. */
export interface AgentVersionNoticeProps {
  /** The agent's display name, as the notice names it. */
  readonly agentName: string;
  /**
   * The keys the current version reads from the person's My vault; named
   * beside the control when there are any.
   */
  readonly personalKeys?: readonly string[];
  /** Moves the conversation to the agent's current version. */
  readonly onUpdate: () => void;
  /** `true` while the update is in flight; the control is disabled. */
  readonly isUpdating?: boolean;
  /** The last update's failure, shown beside the control. */
  readonly error?: Error | null;
}

/**
 * "A newer version of <agent> is out" with an Update control, one strip
 * above the composer. The keys the current version reads from the person's
 * My vault, and a failed update, follow the words on the same strip.
 */
export function AgentVersionNotice({
  agentName,
  personalKeys = [],
  onUpdate,
  isUpdating = false,
  error = null,
}: AgentVersionNoticeProps) {
  return (
    <ComposerStrip
      role="status"
      icon={
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="stg:text-muted-foreground">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      }
      act={
        <Button variant="ghost" size="xs" onClick={onUpdate} disabled={isUpdating}>
          {isUpdating ? "Updating…" : "Update"}
        </Button>
      }
    >
      A newer version of {agentName || "its agent"} is out
      {personalKeys.length > 0 && (
        <>
          . It can read these keys from your My vault:{" "}
          <span data-testid="agent-version-personal-keys" className="stg:font-mono">
            {personalKeys.join(", ")}
          </span>
        </>
      )}
      {error && (
        <span role="alert" className="stg:ml-2 stg:text-destructive">
          {getUserMessage(error)}
        </span>
      )}
    </ComposerStrip>
  );
}
