"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { Button } from "../button/Button.js";
import { ChannelToolCredentials } from "./ChannelToolCredentials.js";
import { agentChannelToInput, useSaveAgentChannel } from "./useSaveAgentChannel.js";

/** Props for {@link ChannelCredentialsDialog}. */
export interface ChannelCredentialsDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent the channel serves (drives the readiness hint). */
  readonly agent: Agent;
  /** The channel whose credential bindings are edited. */
  readonly channel: AgentChannel;
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
 * (`AgentChannelSpec.environment_refs`) after the fact — the companion
 * to binding at connect time in {@link ConnectSlackDialog}. Saves are
 * full-input applies via {@link agentChannelToInput}, so the agent
 * reference, provider marker, and install status all survive; an
 * emptied list is an explicit unbind.
 *
 * Built on the native `<dialog>` element, matching the SDK's modal
 * convention. Most hosts mount it via {@link AgentChannelsPanel}'s
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  // Sync native dialog open state (matches the SDK dialog convention).
  const prevOpenRef = useRef(false);
  if (modal && open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      open={modal ? undefined : open}
      onClose={handleClose}
      className={cn(
        "w-full max-w-md rounded-xl border border-border bg-popover p-0 shadow-xl",
        modal ? "fixed inset-0 m-auto backdrop:bg-black/50" : "relative",
      )}
      aria-labelledby="channel-credentials-title"
    >
      {/* Body mounts only while open so its draft resets per session —
          reopening never resumes stale, unsaved edits. */}
      {open && (
        <ChannelCredentialsDialogBody
          agent={agent}
          channel={channel}
          onSaved={onSaved}
          onClose={handleClose}
        />
      )}
    </dialog>
  );
}

function ChannelCredentialsDialogBody({
  agent,
  channel,
  onSaved,
  onClose,
}: {
  readonly agent: Agent;
  readonly channel: AgentChannel;
  readonly onSaved?: () => void;
  readonly onClose: () => void;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";
  const org = channel.metadata?.org ?? "";

  const { save, isPending, error, clearError } = useSaveAgentChannel();

  const [draft, setDraft] = useState<ResourceRef[]>(() =>
    (channel.spec?.environmentRefs ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
    })),
  );

  const handleSave = useCallback(async () => {
    try {
      // Full-input apply: only the binding list changes; an empty draft
      // is an explicit unbind (apply semantics replace the spec).
      await save({
        ...agentChannelToInput(channel),
        environmentRefs: [...draft],
      });
      onSaved?.();
      onClose();
    } catch {
      // Surfaced through the hook's error state below.
    }
  }, [channel, draft, onClose, onSaved, save]);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2
            id="channel-credentials-title"
            className="text-sm font-semibold text-foreground"
          >
            Tool credentials
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {channelName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={cn(
            "rounded p-1 text-muted-foreground",
            "hover:bg-accent-hover hover:text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="px-5 py-4">
        <ChannelToolCredentials
          agent={agent}
          org={org}
          value={draft}
          onChange={setDraft}
          disabled={isPending}
          enabled={channel.spec?.enabled ?? false}
        />

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
          >
            {getUserMessage(error)}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
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
          size="sm"
          onClick={() => void handleSave()}
          disabled={isPending}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 8 8M11 3l-8 8" />
    </svg>
  );
}
