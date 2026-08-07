"use client";

import { useCallback, useRef } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { MessageSquare, User, X } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { channelSessionExternalUserKey } from "../session/channelOrigin.js";
import { useChannelSessions } from "./useChannelSessions.js";

/** Props for {@link ChannelConversationsDialog}. */
export interface ChannelConversationsDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The channel whose conversations are listed. */
  readonly channel: AgentChannel;
  /**
   * Maps a session id to the host's session route (the console passes
   * `` (id) => `/sessions/${id}` ``). When absent, rows render without
   * links — the SDK never assumes a routing scheme (DD-004).
   */
  readonly sessionHref?: (sessionId: string) => string;
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
 * Lists the SESSIONS a channel created — the session-level forensics view
 * (which execution containers served the channel's traffic), visible to
 * exactly the channel's viewers (the connector and org admins; design
 * decision 012).
 *
 * Deliberately titled "Sessions", not "Conversations": the customer-facing
 * Conversations surface is the top-level `ConversationsWorkbench` over the
 * conversation timeline API, which supersedes this read for that purpose
 * (channel-conversations DD-004 D-g). This dialog remains what it actually
 * is — the observability view underneath a conversation. The component
 * name keeps its historical export for API stability.
 *
 * Each row shows the session subject, the external platform user it
 * belongs to (an opaque provider id in v1), and the last activity time.
 * Rows link to the host's session route, where `SessionViewer` renders the
 * transcript read-only (the observer audience — channel viewers hold
 * `can_view` only, never `can_create_execution_in`).
 *
 * Built on the native `<dialog>` element, matching the SDK's modal
 * convention. Most hosts mount it via {@link AgentChannelsPanel}'s
 * channel card action.
 */
export function ChannelConversationsDialog({
  open,
  onOpenChange,
  channel,
  sessionHref,
  modal = true,
}: ChannelConversationsDialogProps) {
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
        "w-full max-w-lg rounded-xl border border-border bg-popover p-0 shadow-xl",
        modal ? "fixed inset-0 m-auto backdrop:bg-black/50" : "relative",
      )}
      aria-labelledby="channel-conversations-title"
    >
      {/* Body mounts only while open so each opening fetches fresh. */}
      {open && (
        <ChannelConversationsDialogBody
          channel={channel}
          sessionHref={sessionHref}
          onClose={handleClose}
        />
      )}
    </dialog>
  );
}

function ChannelConversationsDialogBody({
  channel,
  sessionHref,
  onClose,
}: {
  readonly channel: AgentChannel;
  readonly sessionHref?: (sessionId: string) => string;
  readonly onClose: () => void;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";
  const { sessions, isLoading, error } = useChannelSessions(
    channel.metadata?.id ?? "",
  );

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2
            id="channel-conversations-title"
            className="text-sm font-semibold text-popover-foreground"
          >
            Sessions
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            The sessions {channelName} created — read-only, visible to the
            channel&apos;s owner and org admins.
          </p>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close sessions"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <ConversationsSkeleton />
        ) : error ? (
          <p className="px-2 py-6 text-center text-sm text-destructive">
            {getUserMessage(error)}
          </p>
        ) : sessions.length === 0 ? (
          <EmptyState
            variant="first-use"
            icon={<MessageSquare className="size-8" />}
            title="No sessions yet"
            description="When someone messages this channel, the sessions serving them appear here."
          />
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <ConversationRow
                key={session.metadata?.id}
                session={session}
                href={
                  sessionHref && session.metadata?.id
                    ? sessionHref(session.metadata.id)
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  session,
  href,
}: {
  readonly session: Session;
  readonly href?: string;
}) {
  const subject = session.spec?.subject || "Untitled session";
  const externalUser = channelSessionExternalUserKey(session);
  const lastActivity = lastActivityDate(session);

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground" title={subject}>
          {subject}
        </p>
        {externalUser && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <User aria-hidden="true" className="size-3" />
            {externalUser}
          </p>
        )}
      </div>
      {lastActivity && (
        <span className="shrink-0 text-xs text-muted-foreground-faint">
          {formatRelativeTime(lastActivity)}
        </span>
      )}
    </>
  );

  const rowClass =
    "flex items-center gap-3 rounded-md px-2 py-2 text-left";

  return (
    <li>
      {href ? (
        <a
          href={href}
          className={cn(
            rowClass,
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {content}
        </a>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function ConversationsSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted-faint" />
      ))}
    </div>
  );
}

/**
 * The session's last activity: `statusAudit.updatedAt` (bumped on every
 * meaningful status change), falling back to `specAudit.createdAt` —
 * the recent-activity sort key, so the dialog agrees with the server's
 * ordering.
 */
function lastActivityDate(session: Session): Date | null {
  const ts =
    session.status?.audit?.statusAudit?.updatedAt ??
    session.status?.audit?.specAudit?.createdAt;
  return ts ? timestampDate(ts) : null;
}
