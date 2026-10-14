"use client";

/** Settings section for the active organization's embedding settings: how its product signs people in. */
import { useId } from "react";
import { OrgEmbeddingPanel } from "../organization/OrgEmbeddingPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { SERVICE_ACCOUNTS_SETTINGS_HREF } from "../service-account/copy.js";

/** Props for {@link OrgEmbeddingSection}. */
export interface OrgEmbeddingSectionProps {
  /** Where the panel links to manage service accounts (a hash route in the desktop app). */
  readonly serviceAccountsHref?: string;
}

/** Settings section for editing the active organization's embedding settings. */
export function OrgEmbeddingSection({
  serviceAccountsHref = SERVICE_ACCOUNTS_SETTINGS_HREF,
}: OrgEmbeddingSectionProps = {}) {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold">
        Embedding
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        How people sign in to this organization from your own product.
      </p>

      {!orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its embedding settings.
        </p>
      ) : (
        <OrgEmbeddingPanel org={orgId} serviceAccountsHref={serviceAccountsHref} />
      )}
    </section>
  );
}
