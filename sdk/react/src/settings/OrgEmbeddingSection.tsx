"use client";

// The Embedding settings page: how people sign in to the active
// organization from its own product. The panel asks whether the person may
// change the settings and draws its own data states.

import { OrgEmbeddingPanel } from "../organization/OrgEmbeddingPanel.js";
import { useOrg } from "../organization/OrgProvider.js";
import { SERVICE_ACCOUNTS_SETTINGS_HREF } from "../service-account/copy.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Props for {@link OrgEmbeddingSection}. */
export interface OrgEmbeddingSectionProps {
  /** Where the panel links to manage service accounts (a hash route in the desktop app). */
  readonly serviceAccountsHref?: string;
}

/** Settings section for editing the active organization's embedding settings. */
export function OrgEmbeddingSection({
  serviceAccountsHref = SERVICE_ACCOUNTS_SETTINGS_HREF,
}: OrgEmbeddingSectionProps = {}) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <SettingsPage title="Embedding" description="How people sign in to this organization from your own product.">
      {!orgId ? (
        <NoOrganization what="its embedding settings" />
      ) : (
        <OrgEmbeddingPanel org={orgId} serviceAccountsHref={serviceAccountsHref} />
      )}
    </SettingsPage>
  );
}
