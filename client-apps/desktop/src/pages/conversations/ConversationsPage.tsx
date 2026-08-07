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
 * router mapping (`/conversations/:channelId/:key`) and the channel
 * access panel mount.
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
          selected ? (
            <ManageAccessButton
              resource={{
                kind: ApiResourceKind.agent_channel,
                kindString: "agent_channel",
                id: selected.agentChannelId,
                org,
              }}
              label="Manage access"
            />
          ) : undefined
        }
      />
    </div>
  );
}
