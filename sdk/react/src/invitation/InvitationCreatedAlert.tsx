"use client";

import { useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";
import { selectElementText } from "../internal/select-element-text.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

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
  const { copy, copied } = useCopyFeedback();
  const revealRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(async () => {
    if (await copy(inviteUrl)) return;
    // Rejected write: select the revealed URL so the user can copy manually.
    if (revealRef.current) selectElementText(revealRef.current);
  }, [copy, inviteUrl]);

  return (
    <div
      role="alert"
      className={cn(
        "stg:rounded-lg stg:border stg:border-primary/30 stg:bg-primary-subtle stg:p-4",
        className,
      )}
    >
      <div className="stg:mb-2 stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">
            Invite link created: {label}
          </p>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            Share this link to invite people to your organization.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn(
            "stg:shrink-0 stg:rounded stg:p-1",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:transition-colors",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="stg:flex stg:items-center stg:gap-2">
        <code
          ref={revealRef}
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:select-all stg:truncate stg:rounded-md",
            "stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5",
            "stg:font-mono stg:text-xs stg:text-foreground",
          )}
        >
          {inviteUrl}
        </code>

        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:transition-colors",
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
