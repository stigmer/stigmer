"use client";

import {
  OAuthAppListPanel,
  useResourceAvailable,
  CloudFeatureNotice,
  ApiResourceKind,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

export function OAuthAppsSection() {
  const org = useActiveOrgSlug();
  const oauthAppsAvailable = useResourceAvailable(ApiResourceKind.oauth_app);

  return (
    <section aria-labelledby="oauth-apps-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="oauth-apps-heading"
          className="text-foreground text-sm font-semibold"
        >
          OAuth Apps
        </h2>
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        OAuth app credentials configured for your organization. Manage
        individual OAuth apps from the MCP server detail page where they were
        created.
      </p>

      {!oauthAppsAvailable ? (
        <CloudFeatureNotice>
          OAuth apps are not available in local mode. Bring-your-own-app
          OAuth requires the cloud platform.
        </CloudFeatureNotice>
      ) : (
        <OAuthAppListPanel org={org} />
      )}
    </section>
  );
}
