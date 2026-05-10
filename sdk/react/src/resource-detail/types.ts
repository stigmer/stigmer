import type { ReactNode } from "react";
import type { StatusPhase } from "../resource-workbench/types";
import type { TabItem } from "../tabs/Tabs";

// ---------------------------------------------------------------------------
// Additional tab — consumer-provided extension tabs for detail views
// ---------------------------------------------------------------------------

/**
 * Describes a consumer-provided tab that extends a detail view's built-in
 * tabs. Used by {@link AgentDetailView} and {@link SkillDetailView} to let
 * platform builders (or the Console) add custom tabs without forking the
 * component.
 *
 * The SDK component defines its own built-in tabs (e.g., "Overview" for
 * agents, "Content" for skills). Consumers extend via `additionalTabs` —
 * providing both the tab metadata and the content to render.
 *
 * @example
 * ```tsx
 * <AgentDetailView
 *   org="acme"
 *   slug="my-agent"
 *   additionalTabs={[
 *     { id: "dependencies", label: "Dependencies", content: <DependencyGraph /> },
 *   ]}
 * />
 * ```
 */
export interface AdditionalTab extends TabItem {
  /** Content rendered in the tab panel when this tab is active. */
  readonly content: ReactNode;
}

// ---------------------------------------------------------------------------
// Detail action — a single operation available on the detail page
// ---------------------------------------------------------------------------

/**
 * Describes an action that can be performed on the currently viewed
 * resource. Used by {@link ResourceActionBar} and the kebab overflow menu.
 *
 * Unlike the workbench's `ResourceAction<TData>`, this is not generic —
 * the detail page already knows what resource it is showing.
 */
export interface DetailAction {
  /** Stable action identifier. */
  readonly id: string;
  /** Display label (e.g. "Edit", "Copy ID", "Delete"). */
  readonly label: string;
  /** Optional icon rendered before the label. */
  readonly icon?: ReactNode;
  /** Optional keyboard shortcut hint. */
  readonly shortcut?: string;
  /**
   * Visual variant.
   * - `"default"` — standard item
   * - `"destructive"` — danger styling for delete, revoke, etc.
   * @default "default"
   */
  readonly variant?: "default" | "destructive";
  /** Fires when the action is selected. */
  readonly onAction: () => void;
  /** When `true`, the action is shown but non-interactive. */
  readonly disabled?: boolean;
  /**
   * Group identifier for organizing actions in the overflow menu.
   * Actions with the same group are visually grouped with separators.
   */
  readonly group?: string;
}

// ---------------------------------------------------------------------------
// Resource header metadata — what the shell renders in the header area
// ---------------------------------------------------------------------------

/**
 * Metadata rendered in the {@link ResourceDetailShell} header.
 *
 * This is the shared shape for all resource types — agent, skill,
 * MCP server, runner. Each detail page maps its resource-specific
 * protobuf to this shape before passing it to the shell.
 */
export interface ResourceHeaderMeta {
  /** Display name of the resource. */
  readonly name: string;
  /** Resource ID (opaque string). */
  readonly id: string;
  /** Organization slug that owns the resource. */
  readonly org?: string;
  /** URL-friendly slug. */
  readonly slug?: string;
  /** Resource description. */
  readonly description?: string;
  /** Optional icon URL (e.g. agent icon). */
  readonly iconUrl?: string;
  /** Optional custom icon element to render instead of `iconUrl`. */
  readonly icon?: ReactNode;
  /** Resource creation timestamp. */
  readonly createdAt?: Date | null;
  /** Last update timestamp. */
  readonly updatedAt?: Date | null;
  /** Resource status phase for the status badge. */
  readonly status?: StatusPhase;
  /** Custom status label (overrides the default phase label). */
  readonly statusLabel?: string;
}

// ---------------------------------------------------------------------------
// Confirm action state — managed by useConfirmAction
// ---------------------------------------------------------------------------

/** Options passed to `confirm()` to show a confirmation prompt. */
export interface ConfirmOptions {
  /** Dialog title (e.g. "Delete agent?"). */
  readonly title: string;
  /** Descriptive body text explaining the consequences. */
  readonly description: string;
  /** Label for the confirm button. @default "Confirm" */
  readonly confirmLabel?: string;
  /** Label for the cancel button. @default "Cancel" */
  readonly cancelLabel?: string;
  /** Visual variant for the confirm button. @default "destructive" */
  readonly variant?: "default" | "destructive";
}

/** Internal state of a pending confirmation. */
export interface ConfirmState extends ConfirmOptions {
  /** Resolves the promise returned by `confirm()`. */
  readonly resolve: (confirmed: boolean) => void;
}

// ---------------------------------------------------------------------------
// ResourceDetailShell props
// ---------------------------------------------------------------------------

export interface ResourceDetailShellProps {
  /** Header metadata extracted from the resource. */
  readonly header: ResourceHeaderMeta;

  /**
   * Visibility control rendered in the header.
   * Typically a `<VisibilityToggle />` from the library module.
   * Rendered inline after the resource name.
   */
  readonly visibilityControl?: ReactNode;

  /**
   * Primary action rendered as a visible button in the header area.
   * Use for the most common action (e.g. "Edit" for agents).
   */
  readonly primaryAction?: DetailAction;

  /**
   * Secondary actions rendered in the kebab overflow menu.
   * Grouped by the `group` field — groups are separated visually.
   */
  readonly actions?: readonly DetailAction[];

  /**
   * Optional tabs to render below the header.
   * When omitted, children are rendered directly without a tab strip.
   */
  readonly tabs?: readonly TabItem[];
  /** Active tab ID (required when `tabs` is provided). */
  readonly activeTab?: string;
  /** Tab change handler (required when `tabs` is provided). */
  readonly onTabChange?: (tabId: string) => void;
  /** Accessible label for the tab strip. */
  readonly tabsAriaLabel?: string;

  /** Content area — tab panel content or direct children. */
  readonly children: ReactNode;

  /** Additional CSS classes for the root container. */
  readonly className?: string;
}
