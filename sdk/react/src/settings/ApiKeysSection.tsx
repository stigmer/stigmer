"use client";

// The API keys settings page: the person's own keys, making one (its value
// shown once), and revoking one. API keys are served in every edition. The
// list panel draws the rows and their data states.

import { useCallback, useRef, useState } from "react";
import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyListPanel } from "../api-key/ApiKeyListPanel.js";
import { CreateApiKeyForm } from "../api-key/CreateApiKeyForm.js";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import { SettingsPage } from "./SettingsPage.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "reveal"; rawKey: string; keyName: string };

/** Settings section for listing and creating organization API keys. */
export function ApiKeysSection() {
  const org = useActiveOrgId();
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

  const startCreate = useCallback(() => setFlow({ phase: "creating" }), []);

  return (
    <SettingsPage
      title="API keys"
      description="Keys sign the CLI and your own programs in to Stigmer as you. A key works in every organization you belong to, unless you limit it to one."
      actions={
        flow.phase === "idle" && (
          <Button size="sm" onClick={startCreate}>
            New API key
          </Button>
        )
      }
    >
      {flow.phase === "reveal" && (
        <ApiKeyCreatedAlert rawKey={flow.rawKey} keyName={flow.keyName} onDismiss={handleDismissReveal} />
      )}
      {flow.phase === "creating" && (
        <Card>
          <CreateApiKeyForm org={org} onCreated={handleCreated} onCancel={() => setFlow({ phase: "idle" })} />
        </Card>
      )}
      <ApiKeyListPanel
        onRefetchRef={handleRefetchRef}
        emptyAction={flow.phase === "idle" ? { label: "New API key", onClick: startCreate } : undefined}
      />
    </SettingsPage>
  );
}
