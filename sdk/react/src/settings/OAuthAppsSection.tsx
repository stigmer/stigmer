"use client";

// The OAuth apps settings page: the organization's own login apps, which a
// sign-in at an address an app lists uses. The list panel draws its own
// data states.

import { useCallback, useRef, useState } from "react";
import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppListPanel } from "../oauth-app/OAuthAppListPanel.js";
import { CreateOAuthAppForm } from "../oauth-app/CreateOAuthAppForm.js";
import { OAuthAppDetailPanel } from "../oauth-app/OAuthAppDetailPanel.js";
import { OAUTH_APPS_MANAGED_BY_ADMINS } from "../oauth-app/copy.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { Button } from "../button/Button.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { ASK_AN_ADMIN, NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; oauthApp: OAuthApp };

/**
 * Settings section for organization OAuth app credentials.
 *
 * "New OAuth app" is offered once the server confirms the caller holds
 * `can_create_oauth_app` on the organization. The list shows only the apps
 * the caller may view (the organization's admins, and anyone granted viewer
 * on an app), so a caller who may not create OAuth apps is told that the
 * organization's admins manage them rather than that none is configured.
 */
export function OAuthAppsSection() {
  const org = useActiveOrgId();
  const oauthAppsAvailable = useResourceAvailable(ApiResourceKind.oauth_app);
  const createCheck = useCheckPermission(
    oauthAppsAvailable && org ? { kind: "organization", id: org } : null,
    "can_create_oauth_app",
  );
  const canCreate = !createCheck.isLoading && createCheck.allowed;
  const deniedCreate = !createCheck.isLoading && !createCheck.allowed;

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
    <SettingsPage
      title="OAuth apps"
      description="Your organization's own login apps. A sign-in at an address uses the app that lists it."
      actions={
        org &&
        canCreate &&
        flow.phase === "idle" && (
          <Button size="sm" onClick={() => setFlow({ phase: "creating" })}>
            New OAuth app
          </Button>
        )
      }
    >
      {!org ? (
        <NoOrganization what="its OAuth apps" />
      ) : flow.phase === "creating" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <CreateOAuthAppForm org={org} onCreated={handleCreated} onCancel={() => setFlow({ phase: "idle" })} />
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
          emptyState={deniedCreate ? OAUTH_APPS_MANAGED_BY_ADMINS : undefined}
          emptyDescription={deniedCreate ? ASK_AN_ADMIN : undefined}
        />
      )}
    </SettingsPage>
  );
}
