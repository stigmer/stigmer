"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link CloudFeatureNotice}. */
export interface CloudFeatureNoticeProps {
  /** Explanation of why the feature is unavailable and what to do instead. */
  readonly children: ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Subdued info notice displayed in place of cloud-only feature content
 * when the connected Stigmer backend does not support the feature.
 *
 * Renders an inline box with an info icon and the provided message.
 * The parent section provides its own heading and description — this
 * component is purely the "why it's absent" explanation.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * No Console-specific dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const available = useResourceAvailable(ApiResourceKind.api_key);
 * if (!available) {
 *   return (
 *     <CloudFeatureNotice>
 *       API keys require Stigmer Cloud. Run with <code>--cloud</code> to enable.
 *     </CloudFeatureNotice>
 *   );
 * }
 * ```
 */
export function CloudFeatureNotice({
  children,
  className,
}: CloudFeatureNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        "bg-muted-subtle text-muted-foreground flex items-start gap-2.5 rounded-lg border border-transparent px-4 py-3",
        className,
      )}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7v4" />
      <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
