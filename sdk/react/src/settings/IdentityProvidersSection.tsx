"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerListPanel } from "../identity-provider/IdentityProviderListPanel.js";
import { FederationIssuerWizard } from "../identity-provider/IdentityProviderWizard.js";
import { FederationIssuerDetailPanel } from "../identity-provider/IdentityProviderDetailPanel.js";
import { FEDERATION_ISSUERS_MANAGED_BY_ADMINS } from "../identity-provider/copy.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useOrg } from "../organization/OrgProvider.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; federationIssuer: FederationIssuer };

/**
 * Settings section for configuring OIDC identity providers: the other
 * platforms whose tokens the organization trusts.
 *
 * "New identity provider" is offered once the server confirms the caller
 * holds `can_create_idp` on the organization. The list shows only the
 * providers the caller may view, so a caller who may not create providers
 * is told that the organization's admins manage them rather than that none
 * is configured.
 */
export function FederationIssuersSection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const idpAvailable = useResourceAvailable(ApiResourceKind.federation_issuer);
  // Requests name the org by its id.
  const orgId = activeOrg?.metadata?.id ?? "";
  const createCheck = useCheckPermission(
    idpAvailable && orgId ? { kind: "organization", id: orgId } : null,
    "can_create_idp",
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

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2
          id={headingId}
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Identity Providers
        </h2>

        {idpAvailable && orgId && canCreate && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + New identity provider
          </button>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Identity providers define external OIDC trust relationships for
        federated authentication: the organization accepts tokens another
        platform issues, such as the platform that manages it.
      </p>

      {!idpAvailable ? (
        <CloudFeatureNotice>
          Identity providers are not available in local mode. Federated
          authentication requires Stigmer Cloud.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage identity providers.
        </p>
      ) : flow.phase === "creating" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <FederationIssuerWizard
            org={orgId}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <FederationIssuerDetailPanel
            federationIssuer={flow.federationIssuer}
            onUpdated={handleUpdated}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <FederationIssuerListPanel
          org={orgId}
          onEdit={(idp) =>
            setFlow({ phase: "editing", federationIssuer: idp })
          }
          onRefetchRef={handleRefetchRef}
          emptyState={
            deniedCreate ? FEDERATION_ISSUERS_MANAGED_BY_ADMINS : undefined
          }
        />
      )}
    </section>
  );
}
