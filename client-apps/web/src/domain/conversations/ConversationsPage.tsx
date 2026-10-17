"use client";

import { useCallback, useMemo } from "react";
import {
  ConversationsWorkbench,
  ManageAccessButton,
  useActiveOrgId,
  useOrgSlugForId,
  type ConversationIdentity,
} from "@stigmer/react-sdk";
import { isDeletedReference } from "@stigmer/client";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
    channelId: decodeURIComponent(match[1]),
    conversationKey: decodeURIComponent(match[2]),
  };
}

/**
 * The Conversations area — a thin shell over the SDK's
 * `ConversationsWorkbench` (zero domain logic here).
 * This file owns exactly three console concerns: mapping selection onto
 * the URL through the app's single navigation source of truth, mounting
 * the CHANNEL access trigger (participant grants are per channel, never
 * per conversation) in the workbench's header seam,
 * and routing the header's channel link to the owning agent's Channels
 * tab (channels have no standalone page).
 */
export function ConversationsPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const { currentPath, navigate } = useAppNavigation();

  const selected = useMemo(() => parseSelection(currentPath), [currentPath]);

  const handleSelectionChange = useCallback(
    (selection: ConversationIdentity | null) => {
      navigate(
        selection
          ? `/conversations/${encodeURIComponent(selection.channelId)}/${encodeURIComponent(selection.conversationKey)}`
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
                    kind: ApiResourceKind.channel,
                    kindString: "channel",
                    id: selected.channelId,
                    org,
                    // The dialog's subtitle names the channel — the
                    // scope every grant covers.
                    name: channel?.metadata?.name || channel?.metadata?.slug,
                  }}
                  label="Channel access"
                />
              )
            : undefined
        }
        channelHref={(channel) =>
          // An agent deleted since the channel was made has no slug and
          // no page: the channel links nowhere.
          channel.spec?.agentRef && !isDeletedReference(channel.spec.agentRef)
            ? `/library/agents/${slugForOrg(channel.spec.agentRef.org || org)}/${channel.spec.agentRef.slug}?tab=channels`
            : null
        }
      />
    </div>
  );
}
