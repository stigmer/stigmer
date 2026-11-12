"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import type { TurnEnding, TurnEndingTone } from "@stigmer/client";
import { Button } from "../button/Button.js";
import { useCopy } from "../internal/CopyBlock.js";

/** The fix a notice links to: its words, and where it goes or what it does. */
export interface RunErrorNoticeLink {
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

const TONE_CLASSES: Readonly<Record<TurnEndingTone, { readonly box: string; readonly icon: string }>> = {
  failed: { box: "stg:bg-status-failed-subtle", icon: "stg:text-status-failed" },
  paused: { box: "stg:bg-status-degraded-subtle", icon: "stg:text-status-degraded" },
  stopped: { box: "stg:bg-muted", icon: "stg:text-muted-foreground" },
};

/**
 * How a turn that didn't finish ended, as one note under it: an icon, a
 * bold sentence on what happened, one that says what wasn't lost or who
 * can fix it, the one act that picks the turn back up, at most one link to
 * the fix, and, when it failed, Copy details (the raw error, the run id and
 * the ending's kind) for a builder or for support.
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
  const tone = TONE_CLASSES[ending.tone];
  const details = [error, runId !== "" ? `Run: ${runId}` : "", ending.kind !== "" ? `Kind: ${ending.kind}` : ""].filter((line) => line !== "").join("\n");
  const { copied, copy } = useCopy(details);
  const fallbackAct = onAct === undefined && onRetry !== undefined && retryMessage !== undefined && ending.act !== "none";
  const act = onAct ?? (fallbackAct ? () => onRetry!(retryMessage!) : undefined);
  const label = actLabel ?? (fallbackAct ? "Run again" : undefined);
  const copyable = ending.tone === "failed" && error !== "";

  return (
    <div
      role={ending.tone === "failed" ? "alert" : "status"}
      className={cn("stg:mx-4 stg:flex stg:items-start stg:gap-3 stg:rounded-lg stg:p-4", tone.box)}
    >
      <span className={cn("stg:mt-0.5 stg:shrink-0", tone.icon)} aria-hidden="true">
        {TONE_ICONS[ending.tone]}
      </span>
      <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-1 stg:text-sm stg:text-foreground">
        <p className="stg:font-semibold">{ending.headline}</p>
        <p className="stg:break-words">{ending.comfort}</p>
        {(act !== undefined && label !== undefined) || link !== undefined || copyable ? (
          <div className="stg:mt-2 stg:flex stg:flex-wrap stg:items-center stg:gap-3">
            {act !== undefined && label !== undefined && (
              <Button size="sm" onClick={act} disabled={acting} aria-busy={acting}>
                {label}
              </Button>
            )}
            {link !== undefined && <NoticeLink link={link} />}
            {copyable && (
              <Button size="xs" variant="ghost" onClick={copy} className="stg:text-muted-foreground">
                {copied ? "Copied" : "Copy details"}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NoticeLink({ link }: { readonly link: RunErrorNoticeLink }) {
  const className =
    "stg:text-sm stg:text-foreground stg:underline stg:decoration-border stg:underline-offset-4 stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm";
  if (link.href === undefined) {
    return (
      <button type="button" onClick={link.onClick} className={className}>
        {link.label}
      </button>
    );
  }
  return (
    <a
      href={link.href}
      onClick={link.onClick}
      className={className}
      {...(link.external === true ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {link.label}
    </a>
  );
}

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TONE_ICONS: Readonly<Record<TurnEndingTone, ReactNode>> = {
  failed: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
  paused: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  stopped: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};
