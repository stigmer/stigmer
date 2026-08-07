import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ConversationsWorkbench,
  ManageAccessButton,
  useActiveOrgSlug,
  type ConversationIdentity,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/**
 * The Conversations area (channel-conversations T04) — the desktop twin
 * of web's `domain/conversations/ConversationsPage` (DD-016 parity): a
 * thin shell over the SDK's `ConversationsWorkbench`, owning only the
 * router mapping (`/conversations/:channelId/:key`), the CHANNEL access
 * trigger mount (participant grants are per channel, never per
 * conversation — DD-010 D-c / F-11), and the header's channel link to
 * the owning agent's Channels tab.
 */
export default function ConversationsPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const { channelId, key } = useParams<{ channelId: string; key: string }>();

  const selected = useMemo<ConversationIdentity | null>(
    () =>
      channelId && key
        ? {
            agentChannelId: decodeURIComponent(channelId),
            conversationKey: decodeURIComponent(key),
          }
        : null,
    [channelId, key],
  );

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
        // A plain-anchor hash URL, the sessionHref convention: the hash
        // router picks it up without a reload. The agent page opens on
        // its default tab (desktop reads no ?tab= param yet); Channels
        // is one click away there.
        channelHref={(channel) =>
          channel.spec?.agentRef
            ? `#/library/agents/${channel.spec.agentRef.org || org}/${channel.spec.agentRef.slug}?tab=channels`
            : null
        }
      />
    </div>
  );
}
