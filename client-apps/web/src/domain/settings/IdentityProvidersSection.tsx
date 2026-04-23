"use client";

import { useCallback, useRef, useState } from "react";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import {
  IdentityProviderListPanel,
  IdentityProviderWizard,
  IdentityProviderDetailPanel,
  useResourceAvailable,
  CloudFeatureNotice,
  ApiResourceKind,
} from "@stigmer/react";
import { useOrg } from "@/domain/_shared/org/org-context";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; identityProvider: IdentityProvider };

export function IdentityProvidersSection() {
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

  return (
    <section aria-labelledby="identity-providers-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="identity-providers-heading"
          className="text-foreground text-sm font-semibold"
        >
          Identity Providers
        </h2>

        {idpAvailable && orgSlug && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New identity provider
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
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
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to manage identity providers.
        </p>
      ) : flow.phase === "creating" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <IdentityProviderWizard
            org={orgSlug}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <IdentityProviderDetailPanel
            identityProvider={flow.identityProvider}
            ssoLoginUrl={
              flow.identityProvider.spec?.isSsoProvider
                ? `${window.location.origin}/login?org=${orgSlug}`
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
