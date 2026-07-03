"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import { ActionMenu } from "../action-menu/index.js";
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
 * When there are no actions at all, renders nothing.
 *
 * @example
 * ```tsx
 * <ResourceActionBar
 *   primaryAction={{
 *     id: "edit",
 *     label: "Edit",
 *     icon: <PencilIcon />,
 *     onAction: () => router.push(editUrl),
 *   }}
 *   actions={[
 *     { id: "copy-id", label: "Copy ID", onAction: () => copyId(id) },
 *     { id: "delete", label: "Delete", variant: "destructive", onAction: handleDelete },
 *   ]}
 * />
 * ```
 */
export function ResourceActionBar({
  primaryAction,
  actions,
  className,
}: ResourceActionBarProps) {
  const hasOverflow = actions != null && actions.length > 0;
  if (!primaryAction && !hasOverflow) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {primaryAction && (
        <button
          type="button"
          onClick={primaryAction.onAction}
          disabled={primaryAction.disabled}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {primaryAction.icon}
          {primaryAction.label}
        </button>
      )}
      {hasOverflow && <OverflowMenu actions={actions} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overflow kebab menu
// ---------------------------------------------------------------------------

function OverflowMenu({
  actions,
}: {
  readonly actions: readonly DetailAction[];
}) {
  const grouped = useGroupedActions(actions);

  return (
    <ActionMenu>
      <ActionMenu.Trigger aria-label="More actions">
        <KebabIcon className="size-4" />
      </ActionMenu.Trigger>
      <ActionMenu.Content>
        {grouped.map((group, groupIndex) => (
          <ActionMenu.Group key={group.key}>
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
  readonly key: string;
  readonly items: readonly DetailAction[];
}

function useGroupedActions(actions: readonly DetailAction[]): ActionGroup[] {
  return useMemo(() => {
    const map = new Map<string, DetailAction[]>();
    for (const action of actions) {
      const key = action.group ?? "__default";
      const list = map.get(key);
      if (list) list.push(action);
      else map.set(key, [action]);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
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
