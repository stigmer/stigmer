"use client";

import { useCallback, useId, useState } from "react";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { type ResourceRef } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { Button } from "../button/Button.js";
import { Notice } from "../internal/surface/Notice.js";
import { ChannelToolCredentials } from "./ChannelToolCredentials.js";
import { useSaveChannel } from "./useSaveChannel.js";
import { saveErrorMessage } from "@stigmer/react-core/internal";
import { keptReference } from "../internal/kept-reference.js";

/** Props for {@link ChannelCredentialsDialog}. */
export interface ChannelCredentialsDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent the channel serves (drives the readiness hint). */
  readonly agent: Agent;
  /** The channel whose credential bindings are edited. */
  readonly channel: Channel;
  /** Called after a successful save (hosts typically pass `refetch`). */
  readonly onSaved?: () => void;
  /**
   * When `false`, renders as an in-flow open dialog instead of a
   * top-layer modal — for embedding in constrained surfaces
   * (documentation demos, visual tests). Interactive hosts keep the
   * default.
   * @default true
   */
  readonly modal?: boolean;
}

/**
 * Edits an installed channel's tool-credential bindings
 * (`ChannelSpec.vaults`) after the fact — the companion
 * to binding at connect time in {@link ConnectSlackDialog}. A save is an
 * update naming `spec.vaults` alone, so the agent reference, provider
 * marker, and install status keep their stored values; an emptied list
 * is an explicit unbind.
 *
 * Built on the native `<dialog>` element, matching the SDK's modal
 * convention. Most hosts mount it via {@link ChannelsPanel}'s
 * channel card action.
 */
export function ChannelCredentialsDialog({
  open,
  onOpenChange,
  agent,
  channel,
  onSaved,
  modal = true,
}: ChannelCredentialsDialogProps) {
  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      width="md"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its draft resets per session —
          reopening never resumes stale, unsaved edits. */}
      {open && (
        <ChannelCredentialsDialogBody
          agent={agent}
          channel={channel}
          onSaved={onSaved}
          onClose={handleClose}
          titleId={titleId}
        />
      )}
    </DialogShell>
  );
}

function ChannelCredentialsDialogBody({
  agent,
  channel,
  onSaved,
  onClose,
  titleId,
}: {
  readonly agent: Agent;
  readonly channel: Channel;
  readonly onSaved?: () => void;
  readonly onClose: () => void;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";
  const org = channel.metadata?.org ?? "";

  const { update, isPending, error, clearError } = useSaveChannel();

  const [draft, setDraft] = useState<ResourceRef[]>(() =>
    (channel.spec?.vaults ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
      ...(ref.id ? { id: ref.id } : {}),
    })),
  );

  const handleSave = useCallback(async () => {
    try {
      // The update names the binding list alone; an empty draft is an
      // explicit unbind.
      await update(channel, { vaults: draft.map(keptReference) });
      onSaved?.();
      onClose();
    } catch {
      // Surfaced through the hook's error state below.
    }
  }, [channel, draft, onClose, onSaved, update]);

  return (
    <>
      <DialogHeader id={titleId} title="Tool credentials" description={channelName} closeLabel="Close dialog" onClose={onClose} closeDisabled={isPending} />

      <DialogBody>
        <ChannelToolCredentials
          agent={agent}
          org={org}
          value={draft}
          onChange={setDraft}
          disabled={isPending}
          enabled={channel.spec?.enabled ?? false}
        />

        {error && (
          <Notice tone="failed" headline={saveErrorMessage(error, "channel")} />
        )}
      </DialogBody>

      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            clearError();
            onClose();
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={isPending}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

