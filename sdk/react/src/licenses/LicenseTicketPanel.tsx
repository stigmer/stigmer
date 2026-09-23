"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { Button } from "../button/index.js";
import { selectElementText } from "../internal/select-element-text.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

const ICON = "stg:size-3.5";

/**
 * The signed ticket of one license, copied or shown on demand.
 *
 * The ticket is a customer credential: whoever holds it runs Stigmer
 * Enterprise as that customer until it expires. So it is never rendered
 * until the operator asks, and "Copy ticket" works without showing it.
 * When the clipboard refuses the write (an insecure context, a denied
 * permission), the panel reveals the ticket and selects it for a manual
 * copy instead of failing silently.
 *
 * The ticket arrives from the parent already in memory: a clipboard write
 * after a network round trip loses the click's user activation in Safari,
 * so the parent reads the license when the view opens, not on the click.
 */
export function LicenseTicketPanel({
  ticket,
  isLoading,
  error,
  className,
}: {
  /** The compact JWS, or `null` while it is being read. */
  readonly ticket: string | null;
  /** `true` while the ticket is being read. */
  readonly isLoading: boolean;
  /** The failure reading the ticket, if any. */
  readonly error: Error | null;
  readonly className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const { copy, copied } = useCopyFeedback();
  const ticketRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(async () => {
    if (!ticket) return;
    if (await copy(ticket)) return;
    setRevealed(true);
    // The reveal renders on the next commit; select once it is in the DOM.
    requestAnimationFrame(() => {
      if (ticketRef.current) selectElementText(ticketRef.current);
    });
  }, [copy, ticket]);

  return (
    <section
      aria-label="Ticket"
      className={cn(
        "stg:space-y-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4",
        className,
      )}
    >
      <div className="stg:flex stg:flex-wrap stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0 stg:space-y-1">
          <h4 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">Ticket</h4>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            The signed key the customer installs on their server. Anyone
            holding it can run it as this customer, so send it only to their
            contact address.
          </p>
        </div>
        {/* Fixed widths: the labels change on toggle and copy, the row must not jump. */}
        <div className="stg:flex stg:shrink-0 stg:gap-2">
          <Button
            variant="outline"
            className="stg:w-28 stg:justify-center"
            disabled={!ticket}
            aria-pressed={revealed}
            icon={revealed ? <EyeOff className={ICON} aria-hidden="true" /> : <Eye className={ICON} aria-hidden="true" />}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? "Hide ticket" : "Show ticket"}
          </Button>
          <Button
            className="stg:w-28 stg:justify-center"
            disabled={!ticket}
            icon={copied ? <Check className={ICON} aria-hidden="true" /> : <Copy className={ICON} aria-hidden="true" />}
            onClick={() => void handleCopy()}
          >
            {copied ? "Copied" : "Copy ticket"}
          </Button>
        </div>
      </div>

      {isLoading && (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground" aria-busy="true">
          Reading the ticket…
        </p>
      )}
      {error && (
        <p className="stg:m-0 stg:text-sm stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      {revealed && ticket && (
        <code
          ref={ticketRef}
          className={cn(
            "stg:block stg:max-h-40 stg:overflow-y-auto stg:break-all stg:select-all stg:rounded-md",
            "stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5",
            "stg:font-mono stg:text-xs stg:text-foreground",
          )}
        >
          {ticket}
        </code>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="stg:sr-only">
        {copied && "Ticket copied to clipboard"}
      </div>
    </section>
  );
}
