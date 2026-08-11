"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ApiKeyCreatedAlert}. */
export interface ApiKeyCreatedAlertProps {
  /** The raw API key value to display. Shown exactly once. */
  readonly rawKey: string;
  /** Human-readable name of the key for context. */
  readonly keyName: string;
  /** Fired when the user dismisses the alert. */
  readonly onDismiss: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * One-time reveal component displayed after a new API key is created.
 *
 * Shows the raw key value in a monospace read-only field with a
 * **Copy** button. The key is only available at creation time — the
 * server never returns it again — so this component prominently warns
 * the user to copy it immediately.
 *
 * This is a standalone alert component, not a modal — the parent
 * decides how to present and position it.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ApiKeyCreatedAlert
 *   rawKey="stgm_live_abc123..."
 *   keyName="ci-deploy-key"
 *   onDismiss={() => setRevealedKey(null)}
 * />
 * ```
 */
export function ApiKeyCreatedAlert({
  rawKey,
  keyName,
  onDismiss,
  className,
}: ApiKeyCreatedAlertProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text so the user can manually copy
      const el = document.getElementById("stgm-api-key-reveal");
      if (el) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [rawKey]);

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
            API key created: {keyName}
          </p>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            Copy this key now. It will not be shown again.
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
          id="stgm-api-key-reveal"
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:select-all stg:truncate stg:rounded-md",
            "stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5",
            "stg:font-mono stg:text-xs stg:text-foreground",
          )}
        >
          {rawKey}
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
