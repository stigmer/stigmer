"use client";

// The card of one chat link (a web channel) in an agent's Channels tab: its
// link path with a copy button, who can chat over it, Active or Paused, the
// on/off switch, and the chat link's menu (Edit, Reset link on a public
// link, Delete). It renders in the frame every channel card shares
// (ChannelCardFrame); a chat link can always serve, so the switch is always
// there for an editor.

import { useCallback } from "react";
import { Copy, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import { appendLinkToken, chatPath, getUserMessage } from "@stigmer/sdk";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { toast } from "../feedback/toast.js";
import { ActionMenu } from "../action-menu/index.js";
import { Switch } from "../switch/Switch.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useRotateChannelLink } from "../chat-link/useRotateChannelLink.js";
import {
  chatLinkAudienceFromProto,
  webConfigOf,
  webLinkTokenOf,
} from "../chat-link/webChannelDraft.js";
import { ChannelCardFrame, ChannelStatePill } from "./ChannelCardFrame.js";
import { CHAT_LINK_TYPE } from "./channelTypes.js";
import { useSaveChannel } from "./useSaveChannel.js";

/** Props for {@link ChatLinkCard}. */
export interface ChatLinkCardProps {
  /** The chat link: a channel of the `web` type. */
  readonly channel: Channel;
  /**
   * Builds the absolute public chat URL from the channel's id; the host
   * owns its public origin. Absent, the copied link is the relative
   * `/chat/<channel id>`.
   */
  readonly buildChatLinkUrl?: (channelId: string) => string;
  /** Opens the chat-link dialog on this link. */
  readonly onEditClick: () => void;
  /** Asks to delete this link (the panel confirms). */
  readonly onDeleteClick: () => void;
  /** Refreshes the list after a change this card made. */
  readonly refetch: () => void;
}

/** One chat link's card. */
export function ChatLinkCard({
  channel,
  buildChatLinkUrl,
  onEditClick,
  onDeleteClick,
  refetch,
}: ChatLinkCardProps) {
  const meta = channel.metadata;
  const id = meta?.id ?? "";
  const name = meta?.name || meta?.slug || "—";
  const enabled = channel.spec?.enabled ?? false;
  const audience = chatLinkAudienceFromProto(webConfigOf(channel)?.audience);

  const { copy } = useCopyResource();
  const { update, isPending } = useSaveChannel();
  const { rotateLink, isPending: isRotating } = useRotateChannelLink(id);

  // Decided here (not via nested permission wrappers) so the menu is
  // hidden entirely when the viewer can do nothing to this link; an empty
  // menu is worse than none. Permissive in OSS, so local single-user sees
  // all.
  const { allowed: canEdit } = useCheckPermission(
    { kind: "channel", id },
    "can_edit",
  );
  const { allowed: canDelete } = useCheckPermission(
    { kind: "channel", id },
    "can_delete",
  );

  // The copied URL carries the link token on a public link (an org
  // audience is gated by membership, not the token). The card shows the
  // bare path: the token is a secret, not an address.
  const displayPath = chatPath(id);
  const copyUrl = (() => {
    const base = buildChatLinkUrl ? buildChatLinkUrl(id) : displayPath;
    return audience === "org" ? base : appendLinkToken(base, webLinkTokenOf(channel));
  })();

  const handleCopyLink = useCallback(() => {
    void copy(copyUrl, "Link");
  }, [copy, copyUrl]);

  // On/off names `spec.enabled` alone, so the switch can never wipe
  // origins, messages, credential bindings or an API-set run override.
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      try {
        await update(channel, { enabled: next });
        toast.success(next ? "Chat link resumed" : "Chat link paused");
        refetch();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [update, channel, refetch],
  );

  const handleResetLink = useCallback(async () => {
    try {
      await rotateLink();
      toast.success("Link reset — the old link no longer works");
      refetch();
    } catch (err) {
      toast.error(getUserMessage(err));
    }
  }, [rotateLink, refetch]);

  return (
    <ChannelCardFrame
      Icon={CHAT_LINK_TYPE.Icon}
      typeLabel={CHAT_LINK_TYPE.label}
      name={name}
      state={
        enabled ? (
          <ChannelStatePill label="Active" tone="success" />
        ) : (
          <ChannelStatePill label="Paused" tone="muted" />
        )
      }
      details={
        <>
          <div className="stg:mt-0.5 stg:flex stg:min-w-0 stg:items-center stg:gap-1.5">
            <TruncatedText
              text={displayPath}
              className="stg:font-mono stg:text-xs stg:text-muted-foreground"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label={`Copy link for ${name}`}
              className={cn(
                "stg:shrink-0 stg:rounded stg:p-1 stg:text-muted-foreground",
                "stg:hover:bg-accent-hover stg:hover:text-foreground",
                "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
              )}
            >
              <Copy className="stg:size-3" aria-hidden="true" />
            </button>
          </div>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground-faint">
            {audience === "org" ? "Organization members" : "Anyone with the link"}
          </p>
        </>
      }
      controls={
        <>
          {canEdit && (
            <Switch
              checked={enabled}
              onCheckedChange={(next) => void handleToggleEnabled(next)}
              disabled={isPending}
              aria-label={`Turn ${name} ${enabled ? "off" : "on"}`}
            />
          )}
          {(canEdit || canDelete) && (
            <ActionMenu>
              <ActionMenu.Trigger aria-label={`Actions for ${name}`}>
                <MoreHorizontal className="stg:size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                {canEdit && (
                  <ActionMenu.Item icon={<Pencil />} onSelect={onEditClick}>
                    Edit
                  </ActionMenu.Item>
                )}
                {/* The menu closes on select and a toast reports the
                    outcome; `disabled` guards a re-fire if the menu is
                    reopened mid-flight. */}
                {canEdit && audience === "public" && (
                  <ActionMenu.Item
                    icon={<RotateCcw />}
                    disabled={isRotating}
                    onSelect={() => void handleResetLink()}
                  >
                    Reset link
                  </ActionMenu.Item>
                )}
                {canEdit && canDelete && <ActionMenu.Separator />}
                {canDelete && (
                  <ActionMenu.Item
                    icon={<Trash2 />}
                    variant="destructive"
                    onSelect={onDeleteClick}
                  >
                    {CHAT_LINK_TYPE.deleteLabel}
                  </ActionMenu.Item>
                )}
              </ActionMenu.Content>
            </ActionMenu>
          )}
        </>
      }
    />
  );
}
