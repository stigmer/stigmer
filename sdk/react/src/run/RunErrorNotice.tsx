"use client";

import type { TurnEnding, TurnEndingTone } from "@stigmer/client";
import { INFO_ICON, Notice, type NoticeLinkSpec, type NoticeTone } from "../internal/surface/Notice.js";

/** The fix a notice links to: its words, and where it goes or what it does. */
export interface RunErrorNoticeLink extends NoticeLinkSpec {
  readonly label: string;
  /** An address to open; absent when the link is an action (`onClick`). */
  readonly href?: string;
  /** Opens outside the host (a provider's billing page): a new tab. */
  readonly external?: boolean;
  readonly onClick?: () => void;
}

/** Props for {@link RunErrorNotice} and its MessageThread slot. */
export interface RunErrorNoticeProps {
  /** The server-reported failure reason (`RunStatus.error`), raw: what Copy details holds, never the headline. */
  readonly error: string;
  /**
   * The originating user message, resent verbatim by {@link onRetry}.
   * Absent when the failed run has no resendable prompt.
   */
  readonly retryMessage?: string;
  /**
   * Resends {@link retryMessage}: the act a notice falls back to when the
   * thread wires no {@link onAct} (a host that renders the notice alone).
   */
  readonly onRetry?: (message: string) => void;
  /**
   * How the turn ended, in words (`describeTurnEnding` from
   * `@stigmer/client`): the headline, the comfort, the tone. Absent, the
   * notice reads the generic "This turn didn't finish."
   */
  readonly ending?: TurnEnding;
  /** The turn's run id, which Copy details names. */
  readonly runId?: string;
  /** The act's words as this viewer is offered it ("Run again", "Send it again"). */
  readonly actLabel?: string;
  /** Takes the act. With no act label or handler, the notice offers none. */
  readonly onAct?: () => void;
  /** The act is in flight: its button waits. */
  readonly acting?: boolean;
  /** The one link to the fix, when this viewer can follow it. */
  readonly link?: RunErrorNoticeLink;
}

const GENERIC: TurnEnding = {
  tone: "failed",
  pill: "Didn't finish",
  headline: "This turn didn't finish.",
  comfort: "Nothing was lost: your message is still here.",
  stepNote: "Stopped here",
  act: "run_again",
  link: "none",
  kind: "",
};

/** The ending kind of a turn interrupted when its machine stopped. */
const INTERRUPTED = "runner_lost";

const NOTICE_TONE: Readonly<Record<TurnEndingTone, NoticeTone>> = {
  failed: "failed",
  paused: "paused",
  stopped: "plain",
};

/**
 * How a turn that didn't finish ended, as one note under it: an icon, a
 * bold sentence on what happened, one that says what wasn't lost or who
 * can fix it, the one act that picks the turn back up, at most one link to
 * the fix, and, when it failed or was interrupted, Copy details (the raw
 * error, the run id and the ending's kind) for a builder or for support.
 *
 * The words come from the ending (`describeTurnEnding`), which reads the
 * failure's kind from the wire, never from the error's text. The tone is
 * the status pill's: red for didn't finish, amber for paused at a limit or
 * interrupted, grey for stopped.
 *
 * Slot-overridable via `MessageThreadSlots.RunErrorNotice`. An override
 * receives the raw error, the ending and the act's wiring, and owns its own
 * presentation.
 */
export function RunErrorNotice({
  error,
  retryMessage,
  onRetry,
  ending = GENERIC,
  runId = "",
  actLabel,
  onAct,
  acting = false,
  link,
}: RunErrorNoticeProps) {
  const details = [error, runId !== "" ? `Run: ${runId}` : "", ending.kind !== "" ? `Kind: ${ending.kind}` : ""].filter((line) => line !== "").join("\n");
  const fallbackAct = onAct === undefined && onRetry !== undefined && retryMessage !== undefined && ending.act !== "none";
  const act = onAct ?? (fallbackAct ? () => onRetry!(retryMessage!) : undefined);
  const label = actLabel ?? (fallbackAct ? "Run again" : undefined);
  // Copy details where someone may need to fix what happened: a failure,
  // and a turn interrupted when its machine stopped. A limit it reached or
  // a stop says all there is in its words.
  const copyable = error !== "" && (ending.tone === "failed" || ending.kind === INTERRUPTED);
  // A limit is a fact to read, not a wait: the info mark. The clock stays
  // for a turn interrupted while it ran, which does wait to resume.
  const icon = ending.tone === "paused" && ending.kind !== INTERRUPTED ? INFO_ICON : undefined;

  return (
    <Notice
      tone={NOTICE_TONE[ending.tone]}
      headline={ending.headline}
      icon={icon}
      // Under a turn in the thread: the act at a card's size.
      actSize="xs"
      act={act !== undefined && label !== undefined ? { label, onClick: act, busy: acting } : undefined}
      link={link}
      details={copyable ? details : ""}
    >
      <p className="stg:m-0 stg:break-words">{ending.comfort}</p>
    </Notice>
  );
}
