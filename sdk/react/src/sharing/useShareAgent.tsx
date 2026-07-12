"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import type { DetailAction } from "../resource-detail/types.js";
import { ShareAgentDialog } from "./ShareAgentDialog.js";

/** Arguments for {@link useShareAgent}. */
export interface UseShareAgentArgs {
  /**
   * The agent whose sharing is managed, or `null` while it is still
   * loading. When `null`, {@link UseShareAgentReturn.action} is `null`
   * and the dialog renders nothing — safe to call before the resource
   * is ready.
   */
  readonly agent: Agent | null;
  /**
   * Builds the absolute public chat URL for the shared agent. The host
   * application owns URL construction (its configured public origin may
   * differ from the rendering origin — e.g. the desktop app). When
   * omitted, the dialog falls back to the relative `/chat/<org>/<slug>`.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /**
   * Called after any sharing change is persisted. Hosts typically pass
   * the agent data hook's `refetch`.
   */
  readonly onSharingChanged?: () => void;
  /** Menu-item label. @default "Share" */
  readonly label?: string;
}

/** Return value of {@link useShareAgent}. */
export interface UseShareAgentReturn {
  /**
   * A ready-to-spread {@link DetailAction} for a kebab/overflow menu, or
   * `null` when the agent is unavailable or the user lacks `can_edit`.
   * Lives in the `"sharing"` group, beside "Manage access".
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
 * Wires the Share dialog to a kebab/overflow menu — the same trigger
 * shape as {@link useManageAccess}, its conceptual sibling: Manage access
 * governs who can *read* the blueprint; Share governs who can *chat* with
 * the running agent (billed to the owning org).
 *
 * Owns the open-state and the `can_edit` gate — the same permission the
 * AgentShare create/apply handlers enforce on the referenced agent, so
 * the action never appears to a user whose changes would be rejected.
 * Returns a `null` action while the agent is loading or the user cannot
 * edit, so the host can unconditionally fold `action` into its actions
 * array.
 *
 * @example
 * ```tsx
 * const share = useShareAgent({
 *   agent,
 *   buildShareUrl: (org, slug) => `${appOrigin}/chat/${org}/${slug}`,
 *   onSharingChanged: refetch,
 * });
 * // ...
 * <ResourceDetailShell actions={share.action ? [...actions, share.action] : actions} ... />
 * {share.dialog}
 * ```
 */
export function useShareAgent({
  agent,
  buildShareUrl,
  onSharingChanged,
  label = "Share",
}: UseShareAgentArgs): UseShareAgentReturn {
  const [isOpen, setIsOpen] = useState(false);

  const agentId = agent?.metadata?.id ?? null;
  const { allowed: canEdit } = useCheckPermission(
    agentId ? { kind: "agent", id: agentId } : null,
    "can_edit",
  );

  const open = useCallback(() => setIsOpen(true), []);

  const action: DetailAction | null =
    agent && canEdit
      ? { id: "share", label, group: "sharing", onAction: open }
      : null;

  const dialog = agent ? (
    <ShareAgentDialog
      open={isOpen}
      onOpenChange={setIsOpen}
      agent={agent}
      buildShareUrl={buildShareUrl}
      onSharingChanged={onSharingChanged}
    />
  ) : null;

  return { action, dialog, open, isOpen };
}
