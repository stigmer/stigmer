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
        "rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      Secret values are shown as <code className="font-mono">***REDACTED***</code>.
      Applying keeps the stored secrets; replace a marker to set a new value.
    </p>
  );
}
