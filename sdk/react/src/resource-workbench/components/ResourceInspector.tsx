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
        "flex w-80 shrink-0 flex-col border-l border-border bg-card",
        "lg:w-96",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Preview
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className={cn(
            "inline-flex items-center justify-center rounded-sm p-1",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
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
