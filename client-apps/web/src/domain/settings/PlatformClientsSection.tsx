"use client";

import { useCallback, useRef, useState } from "react";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import {
  PlatformClientListPanel,
  CreatePlatformClientForm,
  PlatformClientDetailPanel,
  PlatformClientSecretAlert,
  useResourceAvailable,
  CloudFeatureNotice,
  ApiResourceKind,
  useActiveOrgSlug,
} from "@stigmer/react";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | {
      phase: "revealing";
      clientId: string;
      clientSecret: string;
      context: "created" | "rotated";
    }
  | { phase: "editing"; platformClient: PlatformClient };

export function PlatformClientsSection() {
  const org = useActiveOrgSlug();
  const pcAvailable = useResourceAvailable(
    ApiResourceKind.platform_client,
  );

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback(
    (response: PlatformClientCreateResponse) => {
      listRefetchRef.current?.();
      setFlow({
        phase: "revealing",
        clientId: response.platformClient?.spec?.clientId ?? "",
        clientSecret: response.clientSecret,
        context: "created",
      });
    },
    [],
  );

  const handleSecretRotated = useCallback(
    (response: PlatformClientCreateResponse) => {
      listRefetchRef.current?.();
      setFlow({
        phase: "revealing",
        clientId: response.platformClient?.spec?.clientId ?? "",
        clientSecret: response.clientSecret,
        context: "rotated",
      });
    },
    [],
  );

  const handleUpdated = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  const handleDeleted = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  return (
    <section aria-labelledby="platform-clients-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="platform-clients-heading"
          className="text-foreground text-sm font-semibold"
        >
          Platform Clients
        </h2>

        {pcAvailable && org && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New platform client
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Platform clients let your backend mint Stigmer user tokens so you
        can embed Stigmer components in your application without requiring
        OIDC federation.
      </p>

      {!pcAvailable ? (
        <CloudFeatureNotice>
          Platform clients are not available in local mode. Token minting
          requires Stigmer Cloud.
        </CloudFeatureNotice>
      ) : flow.phase === "creating" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <CreatePlatformClientForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "revealing" ? (
        <div className="space-y-4">
          <PlatformClientSecretAlert
            clientId={flow.clientId}
            clientSecret={flow.clientSecret}
            context={flow.context}
            onDismiss={() => setFlow({ phase: "idle" })}
          />
          <PlatformClientListPanel
            org={org}
            onEdit={(pc) =>
              setFlow({ phase: "editing", platformClient: pc })
            }
            onRefetchRef={handleRefetchRef}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <PlatformClientDetailPanel
            platformClient={flow.platformClient}
            onUpdated={handleUpdated}
            onSecretRotated={handleSecretRotated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <PlatformClientListPanel
          org={org}
          onEdit={(pc) =>
            setFlow({ phase: "editing", platformClient: pc })
          }
          onRefetchRef={handleRefetchRef}
        />
      )}
    </section>
  );
}
