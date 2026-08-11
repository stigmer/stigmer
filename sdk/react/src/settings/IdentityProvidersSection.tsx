"use client";

import { useCallback, useRef, useState } from "react";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderListPanel } from "../identity-provider/IdentityProviderListPanel.js";
import { IdentityProviderWizard } from "../identity-provider/IdentityProviderWizard.js";
import { IdentityProviderDetailPanel } from "../identity-provider/IdentityProviderDetailPanel.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Props for {@link IdentityProvidersSection}. */
export interface IdentityProvidersSectionProps {
  /**
   * Base URL used to construct the SSO login link shown in the detail panel.
   * Defaults to `window.location.origin` when omitted (correct for web apps).
   * Desktop apps should pass the cloud console origin instead.
   */
  readonly ssoLoginBaseUrl?: string;
}

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; identityProvider: IdentityProvider };

/** Settings section for configuring OIDC identity providers. */
export function IdentityProvidersSection({
  ssoLoginBaseUrl,
}: IdentityProvidersSectionProps = {}) {
  const { activeOrg } = useOrg();
  const idpAvailable = useResourceAvailable(ApiResourceKind.identity_provider);
  const orgSlug = activeOrg?.metadata?.slug ?? "";

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

  const baseUrl =
    ssoLoginBaseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <section aria-labelledby="identity-providers-heading">
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2
          id="identity-providers-heading"
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Identity Providers
        </h2>

        {idpAvailable && orgSlug && flow.phase === "idle" && (
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
        federated authentication. Configure providers for platform-managed
        organizations or self-managed SSO.
      </p>

      {!idpAvailable ? (
        <CloudFeatureNotice>
          Identity providers are not available in local mode. Federated
          authentication requires Stigmer Cloud.
        </CloudFeatureNotice>
      ) : !orgSlug ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage identity providers.
        </p>
      ) : flow.phase === "creating" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <IdentityProviderWizard
            org={orgSlug}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <IdentityProviderDetailPanel
            identityProvider={flow.identityProvider}
            ssoLoginUrl={
              flow.identityProvider.spec?.isSsoProvider
                ? `${baseUrl}/login?org=${orgSlug}`
                : undefined
            }
            onUpdated={handleUpdated}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <IdentityProviderListPanel
          org={orgSlug}
          onEdit={(idp) =>
            setFlow({ phase: "editing", identityProvider: idp })
          }
          onRefetchRef={handleRefetchRef}
        />
      )}
    </section>
  );
}
