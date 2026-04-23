"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link InvitationCreatedAlert}. */
export interface InvitationCreatedAlertProps {
  /** The full invite URL to display and copy. */
  readonly inviteUrl: string;
  /** Human-readable label describing the invitation's purpose. */
  readonly label: string;
  /** Fired when the user dismisses the alert. */
  readonly onDismiss: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * One-time banner displayed after a new invitation link is created.
 *
 * Shows the invite URL in a monospace read-only field with a **Copy**
 * button. While invite URLs are always retrievable from the invitation
 * list, surfacing the URL immediately after creation provides the
 * critical "copy and share" moment that admins expect.
 *
 * This is a standalone alert component, not a modal — the parent
 * decides how to present and position it.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <InvitationCreatedAlert
 *   inviteUrl="https://app.stigmer.ai/invite/abc123..."
 *   label="Engineering team invite"
 *   onDismiss={() => setCreatedUrl(null)}
 * />
 * ```
 */
export function InvitationCreatedAlert({
  inviteUrl,
  label,
  onDismiss,
  className,
}: InvitationCreatedAlertProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById("stgm-invite-url-reveal");
      if (el) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [inviteUrl]);

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-primary/30 bg-primary-subtle p-4",
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Invite link created: {label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Share this link to invite people to your organization.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn(
            "shrink-0 rounded p-1",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "transition-colors",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <code
          id="stgm-invite-url-reveal"
          className={cn(
            "min-w-0 flex-1 select-all truncate rounded-md",
            "border border-input bg-background px-2.5 py-1.5",
            "font-mono text-xs text-foreground",
          )}
        >
          {inviteUrl}
        </code>

        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "transition-colors",
          )}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
