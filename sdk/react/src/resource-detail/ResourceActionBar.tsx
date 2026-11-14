"use client";

// A resource page's acts: the primary one as a button, the rest in the
// overflow menu. An act that declares the relation it needs (`requires`)
// is offered only when the server answered yes for this resource, never
// while the check is in flight and never when it failed: a person is not
// shown an act the server would refuse. The host declares; the bar asks,
// once per distinct relation. Acts that declare nothing (copy, export) are
// always offered, and a bar with nothing left draws nothing. A list row
// draws one bar per row (named by `menuLabel`), each checking its own
// resource once.

import { useMemo } from "react";
import { cn } from "@stigmer/design-tokens";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import type { PermissionCheckResource } from "../grant/useCheckPermission.js";
import { useCheckPermissions } from "../grant/useCheckPermissions.js";
import type { DetailAction } from "./types.js";

export interface ResourceActionBarProps {
  /**
   * Primary action rendered as a visible button.
   * Use for the most common action on this resource (e.g. "Edit").
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary and tertiary actions rendered in the overflow (kebab) menu.
   * Actions with the same `group` are visually grouped with separators.
   */
  readonly actions?: readonly DetailAction[];
  /**
   * The resource the acts change, which an act's `requires` is checked on.
   * Without it, an act that `requires` a relation is never offered.
   */
  readonly resource?: PermissionCheckResource | null;
  /**
   * The overflow menu's accessible name. A list row that draws a bar per
   * row names each menu after its row ("Actions for linear").
   * @default "More actions"
   */
  readonly menuLabel?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Horizontal action bar for resource detail page headers.
 *
 * Renders an optional primary action as a visible button and any
 * remaining actions in a kebab overflow menu (using the SDK's
 * {@link ActionMenu} compound component).
 *
 * An action with `requires` is offered only when the server answered yes
 * for `resource` (fail closed: not while the check is in flight, not when
 * it failed, never without a `resource`). When no action is left, renders
 * nothing.
 *
 * @example
 * ```tsx
 * import { Pencil } from "lucide-react";
 *
 * function AgentActions({ id, onEdit, onDelete }: { id: string; onEdit: () => void; onDelete: () => void }) {
 *   const { copyId } = useCopyResource();
 *   return (
 *     <ResourceActionBar
 *       resource={{ kind: "agent", id }}
 *       primaryAction={{ id: "edit", label: "Edit", icon: <Pencil />, requires: "can_edit", onAction: onEdit }}
 *       actions={[
 *         { id: "copy-id", label: "Copy ID", onAction: () => copyId(id) },
 *         { id: "delete", label: "Delete", variant: "destructive", requires: "can_delete", onAction: onDelete },
 *       ]}
 *     />
 *   );
 * }
 * ```
 */
export function ResourceActionBar({
  primaryAction: declaredPrimary,
  actions: declaredActions,
  resource,
  menuLabel = "More actions",
  className,
}: ResourceActionBarProps) {
  const { primaryAction, actions } = useOfferedActions(declaredPrimary, declaredActions, resource ?? null);
  const hasOverflow = actions.length > 0;
  if (!primaryAction && !hasOverflow) return null;

  return (
    <div className={cn("stg:flex stg:items-center stg:gap-2", className)}>
      {primaryAction && (
        <Button onClick={primaryAction.onAction} disabled={primaryAction.disabled} icon={primaryAction.icon}>
          {primaryAction.label}
        </Button>
      )}
      {hasOverflow && <OverflowMenu actions={actions} label={menuLabel} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The acts the server allows
// ---------------------------------------------------------------------------

/** The relations the declared acts require, each once. */
function requiredRelations(primary: DetailAction | undefined, actions: readonly DetailAction[] | undefined): readonly string[] {
  const relations = new Set<string>();
  if (primary?.requires) relations.add(primary.requires);
  for (const action of actions ?? []) if (action.requires) relations.add(action.requires);
  return Array.from(relations);
}

/** The declared acts, less every one whose relation the server has not said yes to. */
function useOfferedActions(
  primary: DetailAction | undefined,
  actions: readonly DetailAction[] | undefined,
  resource: PermissionCheckResource | null,
): { readonly primaryAction: DetailAction | undefined; readonly actions: readonly DetailAction[] } {
  const relations = useMemo(() => requiredRelations(primary, actions), [primary, actions]);
  const answers = useCheckPermissions(resource, relations, { fail: "closed" });

  return useMemo(() => {
    // Every relation an act requires was asked (the relations come from these same acts).
    const offered = (action: DetailAction) => action.requires === undefined || answers[action.requires].allowed;
    return {
      primaryAction: primary && offered(primary) ? primary : undefined,
      actions: (actions ?? []).filter(offered),
    };
  }, [primary, actions, answers]);
}

// ---------------------------------------------------------------------------
// Overflow kebab menu
// ---------------------------------------------------------------------------

function OverflowMenu({
  actions,
  label,
}: {
  readonly actions: readonly DetailAction[];
  readonly label: string;
}) {
  const grouped = useGroupedActions(actions);

  return (
    <ActionMenu>
      <ActionMenu.Trigger aria-label={label} size="sm">
        <KebabIcon className="stg:size-4" />
      </ActionMenu.Trigger>
      <ActionMenu.Content>
        {grouped.map((group, groupIndex) => (
          // The groups keep the order the acts gave them, so their position is their identity.
          <ActionMenu.Group key={groupIndex}>
            {groupIndex > 0 && <ActionMenu.Separator />}
            {group.items.map((action) => (
              <ActionMenu.Item
                key={action.id}
                icon={action.icon}
                shortcut={action.shortcut}
                variant={action.variant}
                disabled={action.disabled}
                onSelect={action.onAction}
              >
                {action.label}
              </ActionMenu.Item>
            ))}
          </ActionMenu.Group>
        ))}
      </ActionMenu.Content>
    </ActionMenu>
  );
}

// ---------------------------------------------------------------------------
// Action grouping
// ---------------------------------------------------------------------------

interface ActionGroup {
  readonly items: readonly DetailAction[];
}

/** The acts by their `group`, in the order each group first appears; acts with no group form one group of their own. */
function useGroupedActions(actions: readonly DetailAction[]): ActionGroup[] {
  return useMemo(() => {
    const map = new Map<string | undefined, DetailAction[]>();
    for (const action of actions) {
      const list = map.get(action.group);
      if (list) list.push(action);
      else map.set(action.group, [action]);
    }
    return Array.from(map.values()).map((items) => ({ items }));
  }, [actions]);
}

// ---------------------------------------------------------------------------
// Kebab icon (inline SVG — no icon library dependency)
// ---------------------------------------------------------------------------

function KebabIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="3" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="13" r="1.25" />
    </svg>
  );
}
