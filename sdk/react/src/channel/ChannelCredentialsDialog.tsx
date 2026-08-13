"use client";

import { useCallback, useId, useRef, useState } from "react";
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

  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

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
        "stg:w-full stg:max-w-md stg:rounded-xl stg:border stg:border-border stg:bg-popover stg:p-0 stg:shadow-xl",
        modal ? "stg:fixed stg:inset-0 stg:m-auto stg:backdrop:bg-backdrop" : "stg:relative",
      )}
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
    </dialog>
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
  readonly channel: AgentChannel;
  readonly onSaved?: () => void;
  readonly onClose: () => void;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
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
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id={titleId}
            className="stg:text-sm stg:font-semibold stg:text-foreground"
          >
            Tool credentials
          </h2>
          <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
            {channelName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={cn(
            "stg:rounded stg:p-1 stg:text-muted-foreground",
            "stg:hover:bg-accent-hover stg:hover:text-foreground",
            "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="stg:px-5 stg:py-4">
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
            className="stg:mt-3 stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-destructive"
          >
            {getUserMessage(error)}
          </div>
        )}
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-5 stg:py-3">
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
