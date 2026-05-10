import type { ReactNode } from "react";

/** Props for the {@link ActionMenu} root. */
export interface ActionMenuProps {
  /** Menu content (Trigger + Content). */
  readonly children: ReactNode;
}

/** Props for the `ActionMenu.Trigger` element. */
export interface ActionMenuTriggerProps {
  /** The trigger element (typically an icon button). */
  readonly children: ReactNode;
  /** Additional CSS classes for the trigger wrapper. */
  readonly className?: string;
  /** Accessible label for the trigger. @default "Actions" */
  readonly "aria-label"?: string;
}

/** Props for the `ActionMenu.Content` panel. */
export interface ActionMenuContentProps {
  /** Menu items, groups, and separators. */
  readonly children: ReactNode;
  /**
   * Horizontal alignment relative to the trigger.
   * @default "end"
   */
  readonly align?: "start" | "center" | "end";
  /** Additional CSS classes for the menu popup. */
  readonly className?: string;
}

/** Props for the `ActionMenu.Item`. */
export interface ActionMenuItemProps {
  /** Item label text. */
  readonly children: ReactNode;
  /** Click handler. */
  readonly onSelect?: () => void;
  /** Optional icon rendered before the label. */
  readonly icon?: ReactNode;
  /** Optional keyboard shortcut hint rendered after the label. */
  readonly shortcut?: string;
  /**
   * Visual variant.
   * - `"default"` — standard item styling
   * - `"destructive"` — red/danger styling for delete, remove, revoke actions
   *
   * @default "default"
   */
  readonly variant?: "default" | "destructive";
  /** Whether the item is disabled. */
  readonly disabled?: boolean;
  /** Additional CSS classes. */
  readonly className?: string;
}

/** Props for the `ActionMenu.Separator`. */
export interface ActionMenuSeparatorProps {
  /** Additional CSS classes. */
  readonly className?: string;
}

/** Props for the `ActionMenu.Group`. */
export interface ActionMenuGroupProps {
  /** Group items. */
  readonly children: ReactNode;
  /** Optional label shown above the group. */
  readonly label?: string;
  /** Additional CSS classes. */
  readonly className?: string;
}
