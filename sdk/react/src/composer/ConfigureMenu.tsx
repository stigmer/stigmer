"use client";

import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { ConfigureIcon } from "./icons";

export interface ConfigureMenuItem {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly count: number;
  /** Show a warning indicator (e.g., MCP server needs setup). */
  readonly hasWarning?: boolean;
}

export interface ConfigureMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Which panel is currently drilled into.
   * `null` shows the menu list; a string shows that panel's content.
   */
  readonly activePanel: string | null;
  readonly onActivePanelChange: (panel: string | null) => void;
  readonly items: readonly ConfigureMenuItem[];
  /**
   * Render the content for a given panel id.
   * Called only when `activePanel` matches an item id.
   */
  readonly renderPanel: (itemId: string) => React.ReactNode;
  readonly disabled?: boolean;
}

/**
 * Tier 2 configuration affordance for the composer toolbar.
 *
 * Renders a trigger button with an optional badge and warning indicator.
 * Opens a popover that either shows a menu list (when no panel is active)
 * or drills into the selected item's picker (when a panel is active).
 *
 * Uses a single popover with content switching rather than nested popovers,
 * avoiding z-index and focus-trap issues.
 */
export function ConfigureMenu({
  open,
  onOpenChange,
  activePanel,
  onActivePanelChange,
  items,
  renderPanel,
  disabled,
}: ConfigureMenuProps) {
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const hasWarning = items.some((item) => item.hasWarning);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      onActivePanelChange(null);
    }
  };

  if (items.length === 0) return null;

  const activePanelItem = activePanel
    ? items.find((i) => i.id === activePanel)
    : null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        aria-label="Configure agent, tools, and skills"
      >
        <ConfigureIcon />
        <span className="max-sm:hidden">Configure</span>
        {totalCount > 0 && (
          <span className="rounded-full bg-primary-subtle px-1.5 text-[0.6rem] font-medium text-primary">
            {totalCount}
          </span>
        )}
        {hasWarning && totalCount === 0 && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
            aria-label="Configuration needed"
          />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={cn(
              "z-popover overflow-x-hidden overflow-y-auto rounded-lg border border-border",
              "bg-popover shadow-md text-popover-foreground",
              "max-h-[80vh]",
            )}
          >
            {activePanelItem ? (
              <PanelView
                item={activePanelItem}
                onBack={() => onActivePanelChange(null)}
              >
                {renderPanel(activePanel!)}
              </PanelView>
            ) : (
              <MenuList items={items} onSelect={onActivePanelChange} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// Menu list — shown when no panel is drilled into
// ---------------------------------------------------------------------------

function MenuList({
  items,
  onSelect,
}: {
  items: readonly ConfigureMenuItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="py-1" role="menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => onSelect(item.id)}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors",
            "text-foreground hover:bg-accent-hover",
          )}
        >
          <span className="shrink-0 text-muted-foreground">{item.icon}</span>
          <span className="flex-1 text-left">{item.label}</span>
          {item.hasWarning && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
              aria-label="Needs configuration"
            />
          )}
          {item.count > 0 && (
            <span className="rounded-full bg-primary-subtle px-1.5 text-[0.6rem] font-medium text-primary">
              {item.count}
            </span>
          )}
          <ChevronRightIcon />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel view — shown when a specific item is drilled into
// ---------------------------------------------------------------------------

function PanelView({
  item,
  onBack,
  children,
}: {
  item: ConfigureMenuItem;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border-muted px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent-hover hover:text-foreground"
          aria-label="Back to configuration menu"
        >
          <ChevronLeftIcon />
        </button>
        <span className="shrink-0 text-muted-foreground">{item.icon}</span>
        <span className="text-sm font-medium text-foreground">
          {item.label}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — local to ConfigureMenu
// ---------------------------------------------------------------------------

function ChevronRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4l-4 4 4 4" />
    </svg>
  );
}
