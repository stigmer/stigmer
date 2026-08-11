"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link RedactedSecretsNotice}. */
export interface RedactedSecretsNoticeProps {
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Inline explanation shown when manifest content contains `***REDACTED***`
 * secret markers, so the marker reads as a contract rather than a bug:
 * applying it preserves the stored secret; replacing it sets a new value.
 *
 * Shared by {@link EditResourceYamlDialog} and {@link ApplyManifestDialog}.
 */
export function RedactedSecretsNotice({ className }: RedactedSecretsNoticeProps) {
  return (
    <p
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground",
        className,
      )}
    >
      Secret values are shown as <code className="stg:font-mono">***REDACTED***</code>.
      Applying keeps the stored secrets; replace a marker to set a new value.
    </p>
  );
}
