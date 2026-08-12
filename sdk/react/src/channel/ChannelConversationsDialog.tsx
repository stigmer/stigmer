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
import { TruncatedText } from "../internal/truncated-text.js";
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
        "stg:w-full stg:max-w-lg stg:rounded-xl stg:border stg:border-border stg:bg-popover stg:p-0 stg:shadow-xl",
        modal ? "stg:fixed stg:inset-0 stg:m-auto stg:backdrop:bg-black/50" : "stg:relative",
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
    <div className="stg:flex stg:max-h-[70vh] stg:flex-col">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id="channel-conversations-title"
            className="stg:text-sm stg:font-semibold stg:text-popover-foreground"
          >
            Sessions
          </h2>
          <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
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
          <X className="stg:size-4" />
        </Button>
      </div>

      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:p-3">
        {isLoading ? (
          <ConversationsSkeleton />
        ) : error ? (
          <p className="stg:px-2 stg:py-6 stg:text-center stg:text-sm stg:text-destructive">
            {getUserMessage(error)}
          </p>
        ) : sessions.length === 0 ? (
          <EmptyState
            variant="first-use"
            icon={<MessageSquare className="stg:size-8" />}
            title="No sessions yet"
            description="When someone messages this channel, the sessions serving them appear here."
          />
        ) : (
          <ul className="stg:space-y-1">
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
      <div className="stg:min-w-0 stg:flex-1">
        <TruncatedText
          text={subject}
          className="stg:block stg:text-sm stg:text-foreground"
        />
        {externalUser && (
          <p className="stg:mt-0.5 stg:flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground">
            <User aria-hidden="true" className="stg:size-3" />
            {externalUser}
          </p>
        )}
      </div>
      {lastActivity && (
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground-faint">
          {formatRelativeTime(lastActivity)}
        </span>
      )}
    </>
  );

  const rowClass =
    "stg:flex stg:items-center stg:gap-3 stg:rounded-md stg:px-2 stg:py-2 stg:text-left";

  return (
    <li>
      {href ? (
        <a
          href={href}
          className={cn(
            rowClass,
            "stg:hover:bg-accent stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
    <div className="stg:space-y-1 stg:p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:h-12 stg:animate-pulse stg:rounded-md stg:bg-muted-faint" />
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
