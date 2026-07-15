"use client";

import { useCallback, useRef, useState } from "react";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppListPanel } from "../channel-app/ChannelAppListPanel.js";
import { CreateChannelAppForm } from "../channel-app/CreateChannelAppForm.js";
import { ChannelAppDetailPanel } from "../channel-app/ChannelAppDetailPanel.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "editing"; channelApp: ChannelApp };

/**
 * Settings section for the organization's channel apps — customer-owned
 * Slack apps that agent channels install through instead of the shared
 * Stigmer app (bring your own app: your bot name and icon, and one agent
 * per app per workspace, so multiple agents can serve one workspace).
 *
 * After registering an app here, the connect dialog on any agent's
 * Channels tab offers it as the serving app.
 */
export function ChannelAppsSection() {
  const org = useActiveOrgSlug();
  // Channel installs (the consumer of these credentials) are cloud-only;
  // gate the whole section the way the Channels tab gates connects.
  const installsAvailable = useDeploymentMode() === "cloud";

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback((app: ChannelApp) => {
    listRefetchRef.current?.();
    // Creation lands on the detail panel deliberately: phase two of the
    // setup (the events webhook URL) only exists now.
    setFlow({ phase: "editing", channelApp: app });
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
    <section aria-labelledby="channel-apps-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="channel-apps-heading"
          className="text-foreground text-sm font-semibold"
        >
          Channel Apps
        </h2>

        {installsAvailable && org && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
          >
            + New channel app
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Your own Slack apps for serving agent channels. Connecting through
        your app gives the bot your name and icon, and lets multiple agents
        serve the same workspace — one per app.
      </p>

      {!installsAvailable ? (
        <CloudFeatureNotice>
          Channel apps are not available in local mode. Channel installs
          require Stigmer Cloud.
        </CloudFeatureNotice>
      ) : flow.phase === "creating" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <CreateChannelAppForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : flow.phase === "editing" ? (
        <div className="border-border bg-card rounded-lg border p-4">
          <ChannelAppDetailPanel
            channelApp={flow.channelApp}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </div>
      ) : (
        <ChannelAppListPanel
          org={org}
          onEdit={(app) => setFlow({ phase: "editing", channelApp: app })}
          onRefetchRef={handleRefetchRef}
        />
      )}
    </section>
  );
}
