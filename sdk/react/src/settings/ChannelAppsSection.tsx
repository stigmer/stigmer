"use client";

// The Channel apps settings page: the organization's own Slack and Meta apps
// its agents' channels install through. Channel installs are Stigmer
// Cloud's, so elsewhere the settings frame says what this edition does
// instead. The list panel draws its own data states.

import { useCallback, useRef, useState } from "react";
import type { ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppListPanel } from "../channel-app/ChannelAppListPanel.js";
import {
  CreateChannelAppForm,
  type ChannelAppCreateHandoff,
} from "../channel-app/CreateChannelAppForm.js";
import { ChannelAppDetailPanel } from "../channel-app/ChannelAppDetailPanel.js";
import { CHANNEL_APPS_MANAGED_BY_ADMINS } from "../channel-app/copy.js";
import { useDeploymentMode } from "@stigmer/react-core";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { ASK_AN_ADMIN, NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | {
      phase: "editing";
      channelApp: ChannelApp;
      /**
       * Once-visible create-flow values (the WhatsApp verify token),
       * held in memory only for the detail panel's phase-two setup.
       * Absent when editing reopens from the list later.
       */
      createHandoff?: ChannelAppCreateHandoff;
    };

/**
 * Settings section for the organization's channel apps — customer-owned
 * provider apps (Slack apps, Meta WhatsApp apps) that Slack and WhatsApp
 * channels install through. For Slack that replaces the shared Stigmer app (bring
 * your own app: your bot name and icon, and one agent per app per
 * workspace, so multiple agents can serve one workspace); for WhatsApp a
 * channel app is the only way — there is no platform Meta app.
 *
 * After registering an app here, the connect dialog on any agent's
 * Channels tab offers it as the serving app.
 *
 * "New channel app" is offered once the server confirms the caller holds
 * `can_create_channel_app` on the organization. The list shows only the
 * apps the caller may view (the organization's admins, and anyone granted
 * viewer on an app), so a caller who may not create channel apps is told
 * that the organization's admins manage them rather than that none is
 * registered.
 */
export function ChannelAppsSection() {
  const org = useActiveOrgId();
  // Channel installs (the consumer of these credentials) are cloud-only;
  // gate the whole section the way the Channels tab gates connects.
  const installsAvailable = useDeploymentMode() === "cloud";
  const createCheck = useCheckPermission(
    installsAvailable && org ? { kind: "organization", id: org } : null,
    "can_create_channel_app",
  );
  const canCreate = !createCheck.isLoading && createCheck.allowed;
  const deniedCreate = !createCheck.isLoading && !createCheck.allowed;

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const startCreate = useCallback(() => setFlow({ phase: "creating" }), []);
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleCreated = useCallback(
    (app: ChannelApp, createHandoff: ChannelAppCreateHandoff) => {
      listRefetchRef.current?.();
      // Creation lands on the detail panel deliberately: phase two of the
      // setup (the events webhook URL — plus, for WhatsApp, the verify
      // token carried in the handoff) only exists now.
      setFlow({ phase: "editing", channelApp: app, createHandoff });
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
    <SettingsPage
      title="Channel apps"
      description="Your own Slack and Meta apps for your agents' channels. A Slack app gives the bot your name and icon and lets several agents serve one workspace, one per app; every WhatsApp channel connects through a Meta app."
      actions={
        org &&
        canCreate &&
        flow.phase === "idle" && (
          <Button size="sm" onClick={startCreate}>
            New channel app
          </Button>
        )
      }
      unavailable={
        !installsAvailable &&
        "Channel apps come with Stigmer Cloud. On this edition agents are not installed in Slack or WhatsApp; a chat link is how people reach them."
      }
    >
      {!org ? (
        <NoOrganization what="its channel apps" />
      ) : flow.phase === "creating" ? (
        <Card>
          <CreateChannelAppForm org={org} onCreated={handleCreated} onCancel={() => setFlow({ phase: "idle" })} />
        </Card>
      ) : flow.phase === "editing" ? (
        <Card>
          <ChannelAppDetailPanel
            channelApp={flow.channelApp}
            createHandoff={flow.createHandoff}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onBack={() => setFlow({ phase: "idle" })}
          />
        </Card>
      ) : (
        <ChannelAppListPanel
          org={org}
          onEdit={(app) => setFlow({ phase: "editing", channelApp: app })}
          onRefetchRef={handleRefetchRef}
          emptyState={deniedCreate ? CHANNEL_APPS_MANAGED_BY_ADMINS : undefined}
          emptyDescription={deniedCreate ? ASK_AN_ADMIN : undefined}
          emptyAction={canCreate ? { label: "New channel app", onClick: startCreate } : undefined}
        />
      )}
    </SettingsPage>
  );
}
