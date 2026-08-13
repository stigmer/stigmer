"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppListPanel } from "../oauth-app/OAuthAppListPanel.js";
import { CreateOAuthAppForm } from "../oauth-app/CreateOAuthAppForm.js";
import { OAuthAppDetailPanel } from "../oauth-app/OAuthAppDetailPanel.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; oauthApp: OAuthApp };

/** Settings section for organization OAuth app credentials. */
export function OAuthAppsSection() {
  const headingId = useId();
  const org = useActiveOrgSlug();
  const oauthAppsAvailable = useResourceAvailable(ApiResourceKind.oauth_app);

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  const handleUpdated = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  const handleDeleted = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2
          id={headingId}
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          OAuth Apps
        </h2>

        {oauthAppsAvailable && org && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + New OAuth app
          </button>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        OAuth app credentials configured for your organization. Create new
        apps here or bring your own from an MCP server&apos;s detail page.
      </p>

      {!oauthAppsAvailable ? (
        <CloudFeatureNotice>
          OAuth apps are not available in local mode. Bring-your-own-app
          OAuth requires the cloud platform.
        </CloudFeatureNotice>
      ) : flow.phase === "creating" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <CreateOAuthAppForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <OAuthAppDetailPanel
            oauthApp={flow.oauthApp}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <OAuthAppListPanel
          org={org}
          onEdit={(app) => setFlow({ phase: "editing", oauthApp: app })}
          onRefetchRef={handleRefetchRef}
        />
      )}
    </section>
  );
}
