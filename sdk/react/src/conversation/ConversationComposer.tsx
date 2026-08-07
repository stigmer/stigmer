"use client";

import { useState } from "react";
import { Send } from "lucide-react";
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
  className,
}: ConversationComposerProps) {
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
      <div className={cn("border-t border-border px-4 py-3", className)}>
        <p className="text-center text-xs text-muted-foreground">{disabledReason}</p>
      </div>
    );
  }

  return (
    <div className={cn("border-t border-border px-4 py-3", className)}>
      {notice && (
        <p
          className={cn(
            "mb-2 text-xs",
            notice.kind === "queued" ? "text-muted-foreground" : "text-destructive",
          )}
          role="status"
        >
          {notice.text}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          {...composer.textareaProps}
          rows={1}
          placeholder="Reply as your business…"
          aria-label="Reply to the customer"
          className={cn(
            "min-h-9 flex-1 resize-none rounded-md border border-border bg-background",
            "px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground-faint",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          {isSending ? <SpinnerIcon /> : <Send aria-hidden="true" className="size-4" />}
          {isSending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
