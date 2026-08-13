"use client";

import { useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";
import { selectElementText } from "../internal/select-element-text.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

/** Props for {@link PlatformClientSecretAlert}. */
export interface PlatformClientSecretAlertProps {
  /** The `client_id` to display alongside the secret for pairing context. */
  readonly clientId: string;
  /** The raw client secret value to display. Shown exactly once. */
  readonly clientSecret: string;
  /** Whether this alert follows a creation or a secret rotation. */
  readonly context: "created" | "rotated";
  /** Fired when the user dismisses the alert. */
  readonly onDismiss: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * One-time reveal component displayed after a platform client is
 * created or its secret is rotated.
 *
 * Shows both the `client_id` (read-only, for context) and the raw
 * `client_secret` with a **Copy** button. The secret is only
 * available once — the server never returns it again — so this
 * component prominently warns the user to copy it immediately.
 *
 * This is a standalone alert component, not a modal — the parent
 * decides how to present and position it.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <PlatformClientSecretAlert
 *   clientId="stgm_pc_abc123"
 *   clientSecret="stgm_secret_xyz..."
 *   context="created"
 *   onDismiss={() => setFlow({ phase: "idle" })}
 * />
 * ```
 */
export function PlatformClientSecretAlert({
  clientId,
  clientSecret,
  context,
  onDismiss,
  className,
}: PlatformClientSecretAlertProps) {
  const title =
    context === "created"
      ? "Platform client created"
      : "Client secret rotated";

  return (
    <div
      role="alert"
      className={cn(
        "stg:rounded-lg stg:border stg:border-primary/30 stg:bg-primary-subtle stg:p-4",
        className,
      )}
    >
      <div className="stg:mb-3 stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">{title}</p>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            Copy the client secret now. It will not be shown again.
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

      <div className="stg:space-y-2">
        <CopyableField
          label="Client ID"
          value={clientId}
        />
        <CopyableField
          label="Client secret"
          value={clientSecret}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyableField (internal)
// ---------------------------------------------------------------------------

function CopyableField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  // Each field owns its feedback: the copied flag and the select-text
  // fallback belong to the markup they describe, so two fields never
  // share (and race on) one parent-level "which field copied" state.
  const { copy, copied } = useCopyFeedback();
  const revealRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(async () => {
    if (await copy(value)) return;
    // Rejected write: select the revealed value so the user can copy manually.
    if (revealRef.current) selectElementText(revealRef.current);
  }, [copy, value]);

  return (
    <div>
      <span className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
        {label}
      </span>
      <div className="stg:mt-0.5 stg:flex stg:items-center stg:gap-2">
        <code
          ref={revealRef}
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:select-all stg:truncate stg:rounded-md",
            "stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5",
            "stg:font-mono stg:text-xs stg:text-foreground",
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={`Copy ${label}`}
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

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="stg:sr-only"
      >
        {copied && `${label} copied to clipboard`}
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
