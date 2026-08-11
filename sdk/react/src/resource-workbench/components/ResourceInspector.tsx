"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link ResourceInspector}. */
export interface ResourceInspectorProps {
  /** Whether the inspector panel is currently visible. */
  readonly open: boolean;
  /** Called when the user closes the inspector (e.g. via the close button). */
  readonly onClose: () => void;
  /** The content to render inside the inspector panel. */
  readonly children: ReactNode;
  /** Accessible label for the panel. @default "Resource inspector" */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the panel. */
  readonly className?: string;
}

/**
 * Split-panel inspector that appears to the right of the workbench
 * content area, providing a preview of the focused resource without
 * navigating away from the list.
 *
 * The inspector is a purely presentational shell — what renders inside
 * it is determined by the consumer via the `children` prop. The parent
 * `ResourceWorkbench` manages open/close state and passes the focused
 * item's detail view.
 */
export function ResourceInspector({
  open,
  onClose,
  children,
  "aria-label": ariaLabel = "Resource inspector",
  className,
}: ResourceInspectorProps) {
  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label={ariaLabel}
      className={cn(
        "stg:flex stg:w-80 stg:shrink-0 stg:flex-col stg:border-l stg:border-border stg:bg-card",
        "stg:lg:w-96",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-4 stg:py-2">
        <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          Preview
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className={cn(
            "stg:inline-flex stg:items-center stg:justify-center stg:rounded-sm stg:p-1",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="stg:flex-1 stg:overflow-y-auto stg:p-4">
        {children}
      </div>
    </aside>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  );
}
