"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link CloudFeatureNotice}. */
export interface CloudFeatureNoticeProps {
  /** Explanation of why the feature is unavailable and what to do instead. */
  readonly children: ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Subdued info notice displayed in place of a feature the connected
 * edition does not offer. Every settings page draws it through
 * `SettingsPage`'s `unavailable`, in one voice: what the feature comes with,
 * then what this edition does instead ("X come with Stigmer Enterprise and
 * Cloud. On this edition …").
 *
 * Renders an inline box with an info icon and the provided message.
 * The page provides its own heading and description — this component is
 * purely the "why it's absent" explanation.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * No Console-specific dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const available = useResourceAvailable(ApiResourceKind.team);
 * if (!available) {
 *   return (
 *     <CloudFeatureNotice>
 *       Teams come with Stigmer Enterprise and Cloud. On this edition roles
 *       are granted on the organization only.
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
        "stg:bg-muted-subtle stg:text-muted-foreground stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:border-transparent stg:px-4 stg:py-3",
        className,
      )}
    >
      <InfoIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0" />
      <p className="stg:text-xs stg:leading-relaxed">{children}</p>
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
