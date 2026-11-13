"use client";

// The Federation issuers settings page: the other platforms whose tokens the
// organization trusts. Served by Stigmer Enterprise and Cloud; elsewhere the
// settings frame says what this edition does instead. The list panel draws
// its own data states.

import { useCallback, useRef, useState } from "react";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerListPanel } from "../federation-issuer/FederationIssuerListPanel.js";
import { FederationIssuerWizard } from "../federation-issuer/FederationIssuerWizard.js";
import { FederationIssuerDetailPanel } from "../federation-issuer/FederationIssuerDetailPanel.js";
import { FEDERATION_ISSUERS_MANAGED_BY_ADMINS } from "../federation-issuer/copy.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import { useOrg } from "../organization/OrgProvider.js";
import { ASK_AN_ADMIN, NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; federationIssuer: FederationIssuer };

/**
 * Settings section for configuring OIDC federation issuers: the other
 * platforms whose tokens the organization trusts.
 *
 * "New federation issuer" is offered once the server confirms the caller
 * holds `can_create_federation_issuer` on the organization. The list shows only the
 * issuers the caller may view, so a caller who may not create issuers
 * is told that the organization's admins manage them rather than that none
 * is configured.
 */
export function FederationIssuersSection() {
  const { activeOrg } = useOrg();
  const issuerAvailable = useResourceAvailable(ApiResourceKind.federation_issuer);
  // Requests name the org by its id.
  const orgId = activeOrg?.metadata?.id ?? "";
  const createCheck = useCheckPermission(
    issuerAvailable && orgId ? { kind: "organization", id: orgId } : null,
    "can_create_federation_issuer",
  );
  const canCreate = !createCheck.isLoading && createCheck.allowed;
  const deniedCreate = !createCheck.isLoading && !createCheck.allowed;

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const startCreate = useCallback(() => setFlow({ phase: "creating" }), []);
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
    <SettingsPage
      title="Federation issuers"
      description="Other platforms whose sign-in tokens this organization accepts, such as the platform that manages it."
      actions={
        orgId &&
        canCreate &&
        flow.phase === "idle" && (
          <Button size="sm" onClick={startCreate}>
            New federation issuer
          </Button>
        )
      }
      unavailable={
        !issuerAvailable &&
        "Federation issuers come with Stigmer Enterprise and Cloud. On this edition the organization accepts no other platform's tokens."
      }
    >
      {!orgId ? (
        <NoOrganization what="its federation issuers" />
      ) : flow.phase === "creating" ? (
        <Card>
          <FederationIssuerWizard org={orgId} onCreated={handleCreated} onCancel={() => setFlow({ phase: "idle" })} />
        </Card>
      ) : flow.phase === "editing" ? (
        <Card>
          <FederationIssuerDetailPanel
            federationIssuer={flow.federationIssuer}
            onUpdated={handleUpdated}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </Card>
      ) : (
        <FederationIssuerListPanel
          org={orgId}
          onEdit={(issuer) => setFlow({ phase: "editing", federationIssuer: issuer })}
          onRefetchRef={handleRefetchRef}
          emptyState={deniedCreate ? FEDERATION_ISSUERS_MANAGED_BY_ADMINS : undefined}
          emptyDescription={deniedCreate ? ASK_AN_ADMIN : undefined}
          emptyAction={canCreate ? { label: "New federation issuer", onClick: startCreate } : undefined}
        />
      )}
    </SettingsPage>
  );
}
