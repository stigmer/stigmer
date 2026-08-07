"use client";

import { useCallback, useMemo } from "react";
import {
  ConversationsWorkbench,
  ManageAccessButton,
  useActiveOrgSlug,
  type ConversationIdentity,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useAppNavigation } from "@/domain/_shared/navigation/app-navigation";

/**
 * Selection lives in the path — `/conversations/<channelId>/<key>` — so
 * deep links, reloads, and the back button all work. Both segments ride
 * `encodeURIComponent`: WhatsApp keys are digits, but Slack keys are
 * thread timestamps and future providers make no promises.
 */
const CONVERSATION_DETAIL_RE = /^\/conversations\/([^/]+)\/([^/]+)\/?$/;

function parseSelection(path: string): ConversationIdentity | null {
  const match = path.match(CONVERSATION_DETAIL_RE);
  if (!match) return null;
  return {
    agentChannelId: decodeURIComponent(match[1]),
    conversationKey: decodeURIComponent(match[2]),
  };
}

/**
 * The Conversations area (channel-conversations T04) — a thin shell over
 * the SDK's `ConversationsWorkbench` (DD-002: zero domain logic here).
 * This file owns exactly three console concerns: mapping selection onto
 * the URL through the app's single navigation source of truth, mounting
 * the CHANNEL access trigger (participant grants are per channel, never
 * per conversation — DD-010 D-c / F-11) in the workbench's header seam,
 * and routing the header's channel link to the owning agent's Channels
 * tab (channels have no standalone page).
 */
export function ConversationsPage() {
  const org = useActiveOrgSlug();
  const { currentPath, navigate } = useAppNavigation();

  const selected = useMemo(() => parseSelection(currentPath), [currentPath]);

  const handleSelectionChange = useCallback(
    (selection: ConversationIdentity | null) => {
      navigate(
        selection
          ? `/conversations/${encodeURIComponent(selection.agentChannelId)}/${encodeURIComponent(selection.conversationKey)}`
          : "/conversations",
      );
    },
    [navigate],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationsWorkbench
        org={org}
        selected={selected}
        onSelectionChange={handleSelectionChange}
        headerAccessory={
          selected
            ? ({ channel }) => (
                <ManageAccessButton
                  resource={{
                    kind: ApiResourceKind.agent_channel,
                    kindString: "agent_channel",
                    id: selected.agentChannelId,
                    org,
                    // The dialog's subtitle names the channel — the
                    // scope every grant covers (F-11).
                    name: channel?.metadata?.name || channel?.metadata?.slug,
                  }}
                  label="Channel access"
                />
              )
            : undefined
        }
        channelHref={(channel) =>
          channel.spec?.agentRef
            ? `/library/agents/${channel.spec.agentRef.org || org}/${channel.spec.agentRef.slug}?tab=channels`
            : null
        }
      />
    </div>
  );
}
