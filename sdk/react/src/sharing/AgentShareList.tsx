"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import {
  appendLinkToken,
  chatPath,
  getUserMessage,
} from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { toast } from "../feedback/toast.js";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { ShareAgentDialog } from "./ShareAgentDialog.js";
import { useAgentShares } from "./useAgentShares.js";
import { useCanCreateAgentShare } from "./useCanCreateAgentShare.js";
import { useDeleteAgentShare } from "./useDeleteAgentShare.js";
import { useRotateShareLink } from "./useRotateShareLink.js";
import {
  draftFromShare,
  sharingAudienceFromProto,
  useSaveAgentShare,
} from "./useSaveAgentShare.js";

/** Props for {@link AgentShareList}. */
export interface AgentShareListProps {
  /** The agent whose shares are managed. */
  readonly agent: Agent;
  /**
   * The viewer's active organization slug. Scopes the list to this
   * org's channels of the agent, and a share created from this list
   * lands in this org — its URL, billing, and credentials belong to it
   * (a **cross-org share** when it differs from the agent's org,
   * decision 013). Omit to default to the agent's own org.
   */
  readonly viewerOrg?: string;
  /**
   * Builds the absolute public chat URL for a share. The host
   * application owns URL construction (its configured public origin may
   * differ from the rendering origin — e.g. the desktop app). When
   * omitted, links fall back to the relative `/chat/<org>/<slug>`.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Management surface for an agent's {@link AgentShare} channels — the
 * agent analog of {@link AgentInstanceList}, rendered in the agent
 * detail view's Shares tab.
 *
 * Lists the viewer's active org's channels of the agent: `viewerOrg`
 * scopes the `getByAgent` call server-side, so a member of several orgs
 * sees exactly the current org context's channels — never a merged list
 * of every org's (decision 013 amendment). Per-row actions: copy link,
 * edit, pause/resume, reset link, delete. Creation goes through the same
 * {@link ShareAgentDialog} and always lands in the viewer's active org;
 * the create bar mirrors the server's via
 * {@link useCanCreateAgentShare}, so the button never appears to a user
 * whose create would be refused.
 *
 * Self-contained: owns its dialog, its confirmation prompts, and its
 * refetch-after-mutation — hosts render it with just the agent and the
 * URL builder.
 *
 * This is an SDK component (DD-001) — embeddable by platform builders.
 */
export function AgentShareList({
  agent,
  viewerOrg,
  buildShareUrl,
  className,
}: AgentShareListProps) {
  const agentId = agent.metadata?.id ?? "";
  // Scope the list to the org whose context the viewer is in; when the
  // host passes no viewerOrg the scope falls back to the agent's own org
  // (the same-org owner flow), matching where creation would land.
  const { shares, isLoading, error, refetch } = useAgentShares(
    agentId,
    viewerOrg || (agent.metadata?.org ?? ""),
  );
  const { allowed: canCreate, shareOrg } = useCanCreateAgentShare(
    agent,
    viewerOrg,
  );
  const { deleteShare } = useDeleteAgentShare();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  // One dialog instance serves both flows: editing the chosen share, or
  // creating a new one in the viewer's org.
  const [editor, setEditor] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly share: AgentShare }
    | null
  >(null);

  const handleDelete = useCallback(
    async (share: AgentShare) => {
      const slug = share.metadata?.slug ?? "";
      const confirmed = await confirm({
        title: "Delete share?",
        description:
          `The link /chat/${share.metadata?.org}/${slug} stops working ` +
          "immediately — including for visitors mid-conversation — and its " +
          "configuration (origins, messages, credential bindings) is gone. " +
          "To stop serving while keeping the configuration, pause it instead.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await deleteShare(share.metadata?.id ?? "");
        toast.success("Share deleted");
        refetch();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [confirm, deleteShare, refetch],
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="stg:py-8 stg:text-center stg:text-sm stg:text-destructive">
        Failed to load shares
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      {shares.length === 0 ? (
        <ShareEmptyState
          canCreate={canCreate}
          onCreateClick={() => setEditor({ mode: "create" })}
        />
      ) : (
        <>
          <div className="stg:flex stg:items-center stg:justify-between">
            <h3 className="stg:text-sm stg:font-medium stg:text-foreground">
              {shares.length} {shares.length === 1 ? "share" : "shares"}
            </h3>
            {canCreate && (
              <Button
                variant="outline"
                size="xs"
                icon={<PlusIcon />}
                onClick={() => setEditor({ mode: "create" })}
              >
                Create share
              </Button>
            )}
          </div>

          <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
            {/* table-fixed keeps the layout deterministic: Name/Link flex and
                truncate, the rest take fixed widths, so a long name or link
                can never push the Actions kebab off the panel's edge. */}
            <table className="stg:w-full stg:table-fixed stg:text-sm">
              <thead>
                <tr className="stg:border-b stg:border-border stg:bg-muted-subtle">
                  <th className="stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Name</th>
                  <th className="stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Link</th>
                  <th className="stg:w-28 stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Audience</th>
                  <th className="stg:w-24 stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Status</th>
                  <th className="stg:w-16 stg:px-4 stg:py-2 stg:text-right stg:font-medium stg:text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="stg:divide-y stg:divide-border">
                {shares.map((share) => (
                  <ShareRow
                    key={share.metadata?.id}
                    share={share}
                    agent={agent}
                    buildShareUrl={buildShareUrl}
                    onEditClick={(s) => setEditor({ mode: "edit", share: s })}
                    onDeleteClick={handleDelete}
                    refetch={refetch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editor && (
        <ShareAgentDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          agent={agent}
          share={editor.mode === "edit" ? editor.share : undefined}
          shareOrg={shareOrg}
          buildShareUrl={buildShareUrl}
          onSharingChanged={refetch}
        />
      )}

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — one share channel
// ---------------------------------------------------------------------------

interface ShareRowProps {
  readonly share: AgentShare;
  readonly agent: Agent;
  readonly buildShareUrl?: (org: string, slug: string) => string;
  readonly onEditClick: (share: AgentShare) => void;
  readonly onDeleteClick: (share: AgentShare) => void;
  readonly refetch: () => void;
}

function ShareRow({
  share,
  agent,
  buildShareUrl,
  onEditClick,
  onDeleteClick,
  refetch,
}: ShareRowProps) {
  const meta = share.metadata;
  const id = meta?.id ?? "";
  const org = meta?.org ?? "";
  const slug = meta?.slug ?? "";
  const enabled = share.spec?.enabled ?? false;
  const audience = sharingAudienceFromProto(share.spec?.audience);
  const isCrossOrg = org !== (agent.metadata?.org ?? "");

  const { copy } = useCopyResource();
  const { save, isPending } = useSaveAgentShare(agent);
  const { rotateShareLink, isPending: isRotating } = useRotateShareLink(id);

  // Decide the row's actions here (not via nested PermissionGate wrappers) so
  // the kebab is hidden entirely when the viewer can do nothing to this
  // share — an empty overflow menu is worse than no menu. Same self-check
  // RPC as PermissionGate; permissive in OSS, so local single-user sees all.
  const { allowed: canEdit } = useCheckPermission(
    { kind: "agent_share", id },
    "can_edit",
  );
  const { allowed: canDelete } = useCheckPermission(
    { kind: "agent_share", id },
    "can_delete",
  );

  // The copyable URL carries the link token on public shares (org
  // audience is gated by membership, not the token). The display stays
  // the bare path — the token is a secret, not an address.
  const displayPath = chatPath(org, slug);
  const copyUrl = (() => {
    const base = buildShareUrl ? buildShareUrl(org, slug) : displayPath;
    return audience === "org"
      ? base
      : appendLinkToken(base, share.status?.shareLinkToken ?? "");
  })();

  const handleCopyLink = useCallback(() => {
    void copy(copyUrl, "Link");
  }, [copy, copyUrl]);

  // Pause/resume is a full-spec save with only `enabled` flipped —
  // draftFromShare guarantees a toggle can never wipe origins, messages,
  // or credential bindings (the fails-closed posture the CLI shares).
  const handleToggleEnabled = useCallback(async () => {
    try {
      await save({ ...draftFromShare(share), enabled: !enabled }, share);
      toast.success(enabled ? "Share paused" : "Share resumed");
      refetch();
    } catch (err) {
      toast.error(getUserMessage(err));
    }
  }, [save, share, enabled, refetch]);

  const handleResetLink = useCallback(async () => {
    try {
      await rotateShareLink();
      toast.success("Link reset — the old link no longer works");
      refetch();
    } catch (err) {
      toast.error(getUserMessage(err));
    }
  }, [rotateShareLink, refetch]);

  return (
    <tr
      className="stg:cursor-pointer stg:transition-colors stg:hover:bg-accent-hover"
      onClick={() => onEditClick(share)}
    >
      <td className="stg:px-4 stg:py-2.5">
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          <span
            className="stg:truncate stg:font-medium stg:text-foreground"
            title={meta?.name || slug || undefined}
          >
            {meta?.name || slug || "\u2014"}
          </span>
          {isCrossOrg && (
            <span
              className={cn(
                "stg:inline-flex stg:shrink-0 stg:items-center stg:rounded-md stg:px-1.5 stg:py-0.5",
                "stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wide",
                "stg:bg-muted stg:text-muted-foreground stg:border stg:border-border",
              )}
              title={`This share lives in ${org}; the agent lives in ${agent.metadata?.org}`}
            >
              Cross-org
            </span>
          )}
        </div>
      </td>

      <td className="stg:px-4 stg:py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-1.5">
          <code
            className="stg:truncate stg:font-mono stg:text-xs stg:text-muted-foreground"
            title={displayPath}
          >
            {displayPath}
          </code>
          <button
            type="button"
            onClick={handleCopyLink}
            aria-label={`Copy link for ${meta?.name || slug}`}
            className={cn(
              "stg:shrink-0 stg:rounded stg:p-1 stg:text-muted-foreground",
              "stg:hover:bg-accent-hover stg:hover:text-foreground",
              "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
            )}
          >
            <CopyIcon />
          </button>
        </div>
      </td>

      <td className="stg:px-4 stg:py-2.5">
        <span className="stg:text-xs stg:text-muted-foreground">
          {audience === "org" ? "Org members" : "Public"}
        </span>
      </td>

      <td className="stg:px-4 stg:py-2.5">
        <span
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs",
            enabled ? "stg:text-foreground" : "stg:text-muted-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "stg:size-1.5 stg:rounded-full",
              enabled ? "stg:bg-success" : "stg:bg-muted-foreground",
            )}
          />
          {enabled ? "Active" : "Paused"}
        </span>
      </td>

      {/* stopPropagation so opening the kebab never triggers the row's
          click-to-edit. The menu content itself is portaled, so its items
          never bubble to the row regardless. */}
      <td className="stg:px-4 stg:py-2.5 stg:text-right" onClick={(e) => e.stopPropagation()}>
        {(canEdit || canDelete) && (
          <ActionMenu>
            <ActionMenu.Trigger
              className="stg:ml-auto"
              aria-label={`Actions for ${meta?.name || slug}`}
            >
              <MoreHorizontal className="stg:size-4" />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              {canEdit && (
                <>
                  {/* Also the only keyboard-reachable path to edit — the
                      row's click-to-edit is mouse-only. */}
                  <ActionMenu.Item
                    icon={<Pencil />}
                    onSelect={() => onEditClick(share)}
                  >
                    Edit
                  </ActionMenu.Item>
                  {/* The menu closes on select; a toast reports the outcome,
                      so no inline pending label is needed. `disabled` guards
                      against a re-fire if the menu is reopened mid-flight. */}
                  <ActionMenu.Item
                    icon={enabled ? <Pause /> : <Play />}
                    disabled={isPending}
                    onSelect={() => void handleToggleEnabled()}
                  >
                    {enabled ? "Pause" : "Resume"}
                  </ActionMenu.Item>
                  {audience === "public" && (
                    <ActionMenu.Item
                      icon={<RotateCcw />}
                      disabled={isRotating}
                      onSelect={() => void handleResetLink()}
                    >
                      Reset link
                    </ActionMenu.Item>
                  )}
                </>
              )}
              {canEdit && canDelete && <ActionMenu.Separator />}
              {canDelete && (
                <ActionMenu.Item
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={() => onDeleteClick(share)}
                >
                  Delete
                </ActionMenu.Item>
              )}
            </ActionMenu.Content>
          </ActionMenu>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function ShareEmptyState({
  canCreate,
  onCreateClick,
}: {
  readonly canCreate: boolean;
  readonly onCreateClick: () => void;
}) {
  return (
    <EmptyState
      variant="first-use"
      icon={<ShareIcon className="stg:size-10" />}
      title="No shares yet"
      description={
        "A share gives this agent a hosted chat link you can send or embed — " +
        "each share is its own channel with its own audience, embed origins, " +
        "and tool credentials."
      }
      action={
        canCreate
          ? { label: "Create share", onClick: onCreateClick, icon: <PlusIcon /> }
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Non-happy states + icons
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="stg:space-y-2 stg:py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:h-12 stg:animate-pulse stg:rounded-md stg:bg-muted-faint" />
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function ShareIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="m5.8 7.1 4.4-2.2M5.8 8.9l4.4 2.2" />
    </svg>
  );
}
