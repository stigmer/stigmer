"use client";

import { useId, useState } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { ChannelSendOutcome } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import type { SendChannelMessageOutput } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { Button } from "../button/Button.js";
import { SpinnerIcon } from "../composer/icons.js";
import { useComposer } from "../composer/useComposer.js";

/** Props for {@link ConversationComposer}. */
export interface ConversationComposerProps {
  /** Send a staff reply (from `useConversationParticipation().reply`). */
  readonly onSend: (text: string) => Promise<SendChannelMessageOutput>;
  /** `true` while a reply is in flight. */
  readonly isSending: boolean;
  /**
   * Why replying is unavailable, when it is — rendered in place of the
   * input (a senderless provider, or a conversation the customer has
   * not started yet). `null` enables the composer.
   */
  readonly disabledReason: string | null;
  /**
   * A pre-send forecast that ANNOTATES the enabled input — the
   * `disabledReason` pattern's sibling with the opposite contract
   * (channel-conversations DD-014 D-e): a closed service window is a
   * forecast, not a structural block, so the input stays usable and the
   * send engines remain the authority. Rendered above the input and
   * associated via `aria-describedby` (never a live region: the
   * advisory is state a reader meets on open, not an event). Compute it
   * with `serviceWindowOf`; `null` or omitted renders nothing.
   */
  readonly advisory?: string | null;
  /** Additional classes for the composer container. */
  readonly className?: string;
}

/**
 * The staff reply composer. Sending is an implicit takeover — the agent
 * goes quiet the moment a staff reply lands, before the send itself —
 * so this composer is only ever rendered alongside the control banner
 * that shows that state change.
 *
 * Outcome honesty: `refused` keeps the draft (the words never left) and
 * renders the server's refusal detail verbatim; `queued` clears it and
 * says the platform is retrying; a thrown failure keeps the draft and
 * renders the error. The timeline shows the delivered item via its own
 * read — this component never fabricates one.
 */
export function ConversationComposer({
  onSend,
  isSending,
  disabledReason,
  advisory,
  className,
}: ConversationComposerProps) {
  const advisoryId = useId();
  const hasAdvisory = advisory != null && advisory !== "";
  const [notice, setNotice] = useState<{
    readonly kind: "refused" | "queued" | "error";
    readonly text: string;
  } | null>(null);

  const composer = useComposer({
    onSubmit: (message) => {
      setNotice(null);
      onSend(message).then(
        (output) => {
          if (output.outcome === ChannelSendOutcome.refused) {
            // The words never left; keep them so the user can adjust.
            composer.setMessage(message);
            setNotice({
              kind: "refused",
              text: output.detail || "The provider refused this message.",
            });
          } else if (output.outcome === ChannelSendOutcome.queued) {
            setNotice({
              kind: "queued",
              text: "Delivery hit a transient issue — the platform is retrying in the background.",
            });
          }
        },
        (err) => {
          composer.setMessage(message);
          setNotice({ kind: "error", text: getUserMessage(err) });
        },
      );
    },
    disabled: disabledReason !== null || isSending,
  });

  if (disabledReason !== null) {
    return (
      <div className={cn("stg:border-t stg:border-border stg:px-4 stg:py-3", className)}>
        <p className="stg:text-center stg:text-xs stg:text-muted-foreground">{disabledReason}</p>
      </div>
    );
  }

  return (
    <div className={cn("stg:border-t stg:border-border stg:px-4 stg:py-3", className)}>
      {/* The persistent forecast sits above the transient send-outcome
          notice: the notice is the more recent event and belongs closest
          to the input it reacts to. */}
      {hasAdvisory && (
        <p
          id={advisoryId}
          className="stg:mb-2 stg:flex stg:items-start stg:gap-1.5 stg:rounded-md stg:bg-status-degraded-subtle stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-status-degraded"
        >
          <TriangleAlert aria-hidden="true" className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" />
          <span className="stg:min-w-0">{advisory}</span>
        </p>
      )}
      {notice && (
        <p
          className={cn(
            "stg:mb-2 stg:text-xs",
            notice.kind === "queued" ? "stg:text-muted-foreground" : "stg:text-destructive",
          )}
          role="status"
        >
          {notice.text}
        </p>
      )}
      <div className="stg:flex stg:items-end stg:gap-2">
        <textarea
          {...composer.textareaProps}
          rows={1}
          placeholder="Reply as your business…"
          aria-label="Reply to the customer"
          aria-describedby={hasAdvisory ? advisoryId : undefined}
          className={cn(
            "stg:min-h-9 stg:flex-1 stg:resize-none stg:rounded-md stg:border stg:border-border stg:bg-background",
            "stg:px-3 stg:py-2 stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground-faint",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={composer.submit}
          disabled={!composer.canSubmit || isSending}
          aria-label="Send reply"
        >
          {/* The house in-flight glyph (the session composer's pattern):
              the spinner replaces the Send icon so the button itself
              reports progress, not just its label. */}
          {isSending ? <SpinnerIcon /> : <Send aria-hidden="true" className="stg:size-4" />}
          {isSending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
