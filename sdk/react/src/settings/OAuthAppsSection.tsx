"use client";

import { useCallback, useRef, useState } from "react";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppListPanel } from "../oauth-app/OAuthAppListPanel";
import { CreateOAuthAppForm } from "../oauth-app/CreateOAuthAppForm";
import { OAuthAppDetailPanel } from "../oauth-app/OAuthAppDetailPanel";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice";
import { useActiveOrgSlug } from "../organization/OrgProvider";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; oauthApp: OAuthApp };

export function OAuthAppsSection() {
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
    <section aria-labelledby="oauth-apps-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="oauth-apps-heading"
          className="text-foreground text-sm font-semibold"
        >
          OAuth Apps
        </h2>

        {oauthAppsAvailable && org && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New OAuth app
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        OAuth app credentials configured for your organization. Create new
        apps here or bring your own from an MCP server&apos;s detail page.
      </p>

      {!oauthAppsAvailable ? (
        <CloudFeatureNotice>
          OAuth apps are not available in local mode. Bring-your-own-app
          OAuth requires the cloud platform.
        </CloudFeatureNotice>
      ) : flow.phase === "creating" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <CreateOAuthAppForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="border-border bg-card rounded-lg border p-4">
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
