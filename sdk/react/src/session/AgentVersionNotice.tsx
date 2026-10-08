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

import { getUserMessage } from "@stigmer/sdk";

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
 * "This conversation runs an older version of <agent>." with an Update
 * control.
 */
export function AgentVersionNotice({
  agentName,
  personalKeys = [],
  onUpdate,
  isUpdating = false,
  error = null,
}: AgentVersionNoticeProps) {
  return (
    <div
      role="status"
      className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:border-t stg:border-border-muted stg:px-4 stg:py-1.5 stg:text-xs stg:text-muted-foreground"
    >
      <span className="stg:min-w-0 stg:flex-1">
        This conversation runs an older version of {agentName || "its agent"}.
        {personalKeys.length > 0 && (
          <>
            {" "}
            The current version can read these keys from your My
            vault:{" "}
            <span
              data-testid="agent-version-personal-keys"
              className="stg:font-mono"
            >
              {personalKeys.join(", ")}
            </span>
          </>
        )}
      </span>
      {error && (
        <span role="alert" className="stg:text-destructive">
          {getUserMessage(error)}
        </span>
      )}
      <button
        type="button"
        onClick={onUpdate}
        disabled={isUpdating}
        className="stg:shrink-0 stg:rounded stg:font-medium stg:text-foreground stg:underline-offset-2 stg:hover:underline stg:disabled:opacity-50 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      >
        {isUpdating ? "Updating…" : "Update"}
      </button>
    </div>
  );
}
