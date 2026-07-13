"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import type { DetailAction } from "../resource-detail/types.js";
import { ShareAgentDialog } from "./ShareAgentDialog.js";

/** Arguments for {@link useCreateExternalShareLink}. */
export interface UseCreateExternalShareLinkArgs {
  /**
   * The agent to share, or `null` while it is still loading. When
   * `null`, {@link UseCreateExternalShareLinkReturn.action} is `null`
   * and the dialog renders nothing — safe to call before the resource
   * is ready.
   */
  readonly agent: Agent | null;
  /**
   * The viewer's own organization — the org that would own the external
   * share, pay for its traffic, and host its URL. When empty or equal to
   * the agent's org, the action is `null` (the same-org Share entry from
   * {@link useShareAgent} covers that case).
   */
  readonly viewerOrg: string;
  /**
   * Builds the absolute public chat URL for the shared agent. Same
   * contract as {@link useShareAgent}: the host application owns URL
   * construction. When omitted, the dialog falls back to the relative
   * `/chat/<org>/<slug>`.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /** Called after any sharing change is persisted. */
  readonly onSharingChanged?: () => void;
  /** Menu-item label. @default "Create share link" */
  readonly label?: string;
}

/** Return value of {@link useCreateExternalShareLink}. */
export interface UseCreateExternalShareLinkReturn {
  /**
   * A ready-to-spread {@link DetailAction} for a kebab/overflow menu, or
   * `null` when the entry does not apply: agent still loading, same-org
   * (or no) viewer org, agent not marketplace-public, or the viewer
   * lacks `can_create_agent_share` in their own org. Lives in the
   * `"sharing"` group, like its same-org sibling.
   */
  readonly action: DetailAction | null;
  /** The {@link ShareAgentDialog} node — render it once in the host tree. */
  readonly dialog: ReactNode;
  /** Imperatively open the dialog. */
  readonly open: () => void;
  /** Whether the dialog is currently open. */
  readonly isOpen: boolean;
}

/**
 * The marketplace entry for **cross-org shares** (decision 013): a
 * "Create share link" action on another org's marketplace-public agent
 * that opens the same {@link ShareAgentDialog} with the share org set to
 * the viewer's own org. The resulting share is the viewer org's channel —
 * its URL (`/chat/<viewer-org>/<slug>`), its billing, its credential
 * bindings — while the agent blueprint stays live in its own org.
 *
 * The gate mirrors the server's create bar so the action never appears
 * to a user whose create would be refused:
 *
 * - the agent lives in another org and is `visibility_public` — the
 *   origin org's implicit consent (D1); the agent-side `can_execute`
 *   half of the bar is granted to every authenticated account on public
 *   agents by the `allow_public` wildcard, so visibility is its exact
 *   client-side proxy;
 * - the viewer holds `can_create_agent_share` in their own org (D2's
 *   org-side half — admin-level, since a public share spends that org's
 *   credits on the open internet). The org check uses the org slug as
 *   the resource id: an Organization's id equals its slug
 *   (ApiResourceMetadata.id).
 *
 * The same-org Share entry ({@link useShareAgent}, gated on agent
 * `can_edit`) and this one are mutually exclusive by construction — at
 * most one renders for any viewer/agent pair — so hosts can inject both
 * unconditionally.
 *
 * @example
 * ```tsx
 * const externalShare = useCreateExternalShareLink({
 *   agent,
 *   viewerOrg: activeOrgSlug,
 *   buildShareUrl,
 *   onSharingChanged: refetch,
 * });
 * // ...
 * <ResourceDetailShell actions={[...actions, externalShare.action].filter(Boolean)} ... />
 * {externalShare.dialog}
 * ```
 */
export function useCreateExternalShareLink({
  agent,
  viewerOrg,
  buildShareUrl,
  onSharingChanged,
  label = "Create share link",
}: UseCreateExternalShareLinkArgs): UseCreateExternalShareLinkReturn {
  const [isOpen, setIsOpen] = useState(false);

  const agentOrg = agent?.metadata?.org ?? "";
  const isCrossOrg = !!agent && viewerOrg !== "" && viewerOrg !== agentOrg;
  const isPublic =
    agent?.metadata?.visibility === ApiResourceVisibility.visibility_public;

  // The org-side bar is only worth asking about when the entry could
  // apply at all — passing null skips the RPC entirely.
  const { allowed: canCreateShare } = useCheckPermission(
    isCrossOrg && isPublic
      ? { kind: "organization", id: viewerOrg }
      : null,
    "can_create_agent_share",
  );

  const open = useCallback(() => setIsOpen(true), []);

  const applicable = isCrossOrg && isPublic && canCreateShare;

  const action: DetailAction | null = applicable
    ? { id: "create-share-link", label, group: "sharing", onAction: open }
    : null;

  const dialog =
    agent && applicable ? (
      <ShareAgentDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        agent={agent}
        shareOrg={viewerOrg}
        buildShareUrl={buildShareUrl}
        onSharingChanged={onSharingChanged}
      />
    ) : null;

  return { action, dialog, open, isOpen };
}
