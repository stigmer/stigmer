"use client";

import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { useStigmerPortalContainer } from "../portal-container.js";
import { ConfigureIcon } from "./icons.js";

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

  const portalContainer = useStigmerPortalContainer();

  if (items.length === 0) return null;

  const activePanelItem = activePanel
    ? items.find((i) => i.id === activePanel)
    : null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        title="Configure"
        className={cn(
          "stg:inline-flex stg:h-8 stg:w-8 stg:items-center stg:justify-center stg:rounded-md stg:text-xs stg:transition-colors",
          "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
        aria-label="Configure agent, tools, and skills"
      >
        <span className="stg:relative">
          <ConfigureIcon />
          {totalCount > 0 && (
            <span className="stg:absolute stg:-right-1.5 stg:-top-1.5 stg:flex stg:h-3.5 stg:min-w-3.5 stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-0.5 stg:text-[0.5rem] stg:font-medium stg:leading-none stg:text-primary-foreground">
              {totalCount}
            </span>
          )}
          {hasWarning && totalCount === 0 && (
            <span
              className="stg:absolute stg:-right-0.5 stg:-top-0.5 stg:inline-block stg:h-2 stg:w-2 stg:rounded-full stg:bg-warning"
              aria-label="Configuration needed"
            />
          )}
        </span>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={cn(
              "stg:z-popover stg:overflow-x-hidden stg:overflow-y-auto stg:rounded-lg stg:border stg:border-border",
              "stg:bg-popover stg:shadow-md stg:text-popover-foreground",
              "stg:max-h-[80vh]",
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
    <div className="stg:py-1" role="menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => onSelect(item.id)}
          className={cn(
            "stg:flex stg:w-full stg:items-center stg:gap-2.5 stg:px-3 stg:py-2 stg:text-sm stg:transition-colors",
            "stg:text-foreground stg:hover:bg-accent-hover",
          )}
        >
          <span className="stg:shrink-0 stg:text-muted-foreground">{item.icon}</span>
          <span className="stg:flex-1 stg:text-left">{item.label}</span>
          {item.hasWarning && (
            <span
              className="stg:inline-block stg:h-1.5 stg:w-1.5 stg:shrink-0 stg:rounded-full stg:bg-warning"
              aria-label="Needs configuration"
            />
          )}
          {item.count > 0 && (
            <span className="stg:rounded-full stg:bg-primary-subtle stg:px-1.5 stg:text-[0.6rem] stg:font-medium stg:text-primary">
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
      <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-border-muted stg:px-3 stg:py-2">
        <button
          type="button"
          onClick={onBack}
          className="stg:shrink-0 stg:rounded stg:p-0.5 stg:text-muted-foreground stg:transition-colors stg:hover:bg-accent-hover stg:hover:text-foreground"
          aria-label="Back to configuration menu"
        >
          <ChevronLeftIcon />
        </button>
        <span className="stg:shrink-0 stg:text-muted-foreground">{item.icon}</span>
        <span className="stg:text-sm stg:font-medium stg:text-foreground">
          {item.label}
        </span>
      </div>
      <div className="stg:p-3">{children}</div>
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
      className="stg:shrink-0 stg:text-muted-foreground"
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
