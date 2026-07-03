"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyListPanel } from "../api-key/ApiKeyListPanel.js";
import { CreateApiKeyForm } from "../api-key/CreateApiKeyForm.js";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "reveal"; rawKey: string; keyName: string };

/** Settings section for listing and creating organization API keys. */
export function ApiKeysSection() {
  const org = useActiveOrgSlug();
  const apiKeysAvailable = useResourceAvailable(ApiResourceKind.api_key);
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback((apiKey: ApiKey) => {
    const rawKey = apiKey.spec?.keyHash ?? "";
    const keyName = apiKey.metadata?.name ?? "API key";
    setFlow({ phase: "reveal", rawKey, keyName });
    listRefetchRef.current?.();
  }, []);

  const handleDismissReveal = useCallback(() => {
    setFlow({ phase: "idle" });
  }, []);

  return (
    <section aria-labelledby="api-keys-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="api-keys-heading"
          className="text-foreground text-sm font-semibold"
        >
          API Keys
        </h2>

        {apiKeysAvailable && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New API key
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        API keys authenticate CLI sessions and programmatic access to the
        Stigmer API. Keys are scoped to your identity and work across all
        your organizations.
      </p>

      {!apiKeysAvailable ? (
        <CloudFeatureNotice>
          API keys are not available in local mode. When running locally, the
          CLI authenticates directly without API keys.
        </CloudFeatureNotice>
      ) : (
        <>
          {flow.phase === "reveal" && (
            <ApiKeyCreatedAlert
              rawKey={flow.rawKey}
              keyName={flow.keyName}
              onDismiss={handleDismissReveal}
              className="mb-4"
            />
          )}

          {flow.phase === "creating" && (
            <div className="border-border bg-card mb-4 rounded-lg border p-4">
              <CreateApiKeyForm
                org={org}
                onCreated={handleCreated}
                onCancel={() => setFlow({ phase: "idle" })}
              />
            </div>
          )}

          <ApiKeyListPanel onRefetchRef={handleRefetchRef} />
        </>
      )}
    </section>
  );
}
