"use client";

import { cn } from "@stigmer/theme";
import {
  Menu,
  MenuTrigger,
  MenuContent as InternalMenuContent,
  MenuItem as InternalMenuItem,
  MenuSeparator as InternalMenuSeparator,
  MenuGroup as InternalMenuGroup,
  MenuLabel,
} from "../internal/menu.js";
import type {
  ActionMenuProps,
  ActionMenuTriggerProps,
  ActionMenuContentProps,
  ActionMenuItemProps,
  ActionMenuSeparatorProps,
  ActionMenuGroupProps,
} from "./types.js";

/**
 * Compound menu component for resource item actions.
 *
 * Built on top of the SDK's internal Base UI menu primitives with
 * opinionated conventions for resource management UX:
 * - Icon + label + optional shortcut hint layout
 * - Destructive variant for dangerous actions
 * - Grouped sections with labels
 * - Keyboard navigation (arrows, Enter, Esc) via Base UI
 * - Portal rendering with theme inheritance
 *
 * @example
 * ```tsx
 * <ActionMenu>
 *   <ActionMenu.Trigger>
 *     <button aria-label="Agent actions">
 *       <MoreHorizontal className="h-4 w-4" />
 *     </button>
 *   </ActionMenu.Trigger>
 *   <ActionMenu.Content>
 *     <ActionMenu.Item icon={<Edit />} onSelect={handleEdit}>
 *       Edit
 *     </ActionMenu.Item>
 *     <ActionMenu.Item icon={<Copy />} onSelect={handleDuplicate}>
 *       Duplicate
 *     </ActionMenu.Item>
 *     <ActionMenu.Separator />
 *     <ActionMenu.Item
 *       icon={<Trash2 />}
 *       variant="destructive"
 *       onSelect={handleDelete}
 *     >
 *       Delete
 *     </ActionMenu.Item>
 *   </ActionMenu.Content>
 * </ActionMenu>
 * ```
 */
function ActionMenuRoot({ children }: ActionMenuProps) {
  return <Menu>{children}</Menu>;
}

function Trigger({
  children,
  className,
  "aria-label": ariaLabel = "Actions",
}: ActionMenuTriggerProps) {
  return (
    <MenuTrigger
      className={cn(
        "stg:inline-flex stg:items-center stg:justify-center stg:rounded-md stg:p-1",
        "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:data-popup-open:bg-accent stg:data-popup-open:text-foreground",
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
    </MenuTrigger>
  );
}

function Content({ children, align = "end", className }: ActionMenuContentProps) {
  return (
    <InternalMenuContent align={align} className={cn("stg:min-w-44", className)}>
      {children}
    </InternalMenuContent>
  );
}

function Item({
  children,
  onSelect,
  icon,
  shortcut,
  variant = "default",
  disabled,
  className,
}: ActionMenuItemProps) {
  return (
    <InternalMenuItem
      variant={variant}
      disabled={disabled}
      onClick={onSelect}
      className={cn("stg:justify-between", className)}
    >
      <span className="stg:flex stg:items-center stg:gap-2">
        {icon}
        <span>{children}</span>
      </span>
      {shortcut && (
        <kbd className="stg:ml-auto stg:text-[11px] stg:tracking-widest stg:text-muted-foreground-subtle">
          {shortcut}
        </kbd>
      )}
    </InternalMenuItem>
  );
}

function Separator({ className }: ActionMenuSeparatorProps) {
  return <InternalMenuSeparator className={className} />;
}

function Group({ children, label, className }: ActionMenuGroupProps) {
  return (
    <InternalMenuGroup className={className}>
      {label && <MenuLabel>{label}</MenuLabel>}
      {children}
    </InternalMenuGroup>
  );
}

/**
 * Public compound component for resource item action menus.
 *
 * Subcomponents:
 * - `ActionMenu.Trigger` — the element that opens the menu
 * - `ActionMenu.Content` — the menu panel container
 * - `ActionMenu.Item` — a single action (with icon, shortcut, destructive variant)
 * - `ActionMenu.Separator` — a visual divider between items/groups
 * - `ActionMenu.Group` — a labeled section of items
 */
export const ActionMenu = Object.assign(ActionMenuRoot, {
  Trigger,
  Content,
  Item,
  Separator,
  Group,
});
