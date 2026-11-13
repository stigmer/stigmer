"use client";

import { Notice } from "../internal/surface/Notice.js";

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
    <Notice
      tone="plain"
      headline={
        <>
          Secret values are shown as <code className="stg:font-mono">***REDACTED***</code>.
        </>
      }
      className={className}
    >
      <p className="stg:m-0">Applying keeps the stored secrets; replace a marker to set a new value.</p>
    </Notice>
  );
}
