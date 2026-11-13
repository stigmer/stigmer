"use client";

import type { ReactNode } from "react";
import { Notice } from "./surface/Notice.js";

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
 * Renders the kit's plain notice (`Notice`): an info icon and the message.
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
  // A plain sentence pair reads as the notice's headline (what the feature
  // comes with) and its line (what this edition does instead).
  const split = typeof children === "string" ? /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(children) : null;
  if (split) {
    return (
      <Notice tone="plain" role="status" headline={split[1]} className={className}>
        <p className="stg:m-0">{split[2]}</p>
      </Notice>
    );
  }
  return <Notice tone="plain" role="status" headline={children} className={className} />;
}
