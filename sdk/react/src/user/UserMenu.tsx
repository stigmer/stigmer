"use client";

import type { ReactNode } from "react";
import {
  ChevronsUpDown,
  LogOut,
  Settings,
  SunMoon,
  User,
} from "lucide-react";
import { cn } from "@stigmer/theme";
import type { ColorMode } from "../color-mode.js";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../internal/menu.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link UserMenu}. */
export interface UserMenuProps {
  /**
   * The authenticated user. Pass `null` for unauthenticated / local mode,
   * which renders a generic icon and "Local mode" label in the trigger.
   */
  readonly user:
    | {
        /** Display name shown in the trigger and menu header when available. */
        readonly name?: string;
        /** Email shown as secondary identity text. */
        readonly email?: string;
      }
    | null;
  /**
   * Current color mode selection. Accepts the unresolved value
   * (`"light"`, `"dark"`, or `"system"`) so the radio group reflects
   * the user's explicit choice — not the OS-resolved result.
   *
   * When omitted (together with {@link onColorModeChange}), the color
   * scheme section is hidden entirely.
   */
  readonly colorMode?: ColorMode;
  /**
   * Called when the user selects a different color mode.
   *
   * The consumer is responsible for persisting the choice and updating
   * the host application's theme (e.g. calling `next-themes` `setTheme`
   * in the web Console, or writing to localStorage in the desktop app).
   */
  readonly onColorModeChange?: (mode: ColorMode) => void;
  /**
   * Called when the user clicks the "Settings" menu item.
   * When omitted, the Settings item is hidden.
   */
  readonly onSettingsClick?: () => void;
  /**
   * Called when the user clicks "Sign out".
   * When omitted, the Sign out item is hidden.
   */
  readonly onSignOut?: () => void;
  /**
   * Extra menu items rendered between the color scheme section and
   * sign out. Use this for app-specific actions like "Get Desktop App"
   * in the web Console.
   *
   * Items should be `@base-ui/react` `Menu.Item` elements (or the
   * host app's wrapper over them) to participate in the menu's keyboard
   * navigation and ARIA roles.
   */
  readonly extraItems?: ReactNode;
  /** Additional CSS class names merged onto the trigger. */
  readonly className?: string;
}

/**
 * User menu dropdown for sidebar navigation.
 *
 * Displays the current user (avatar + name/email) or a "Local mode"
 * indicator when unauthenticated, with optional color scheme switching,
 * settings navigation, app-specific extra items, and sign out.
 *
 * Designed for sidebar placement — the trigger uses `sidebar-*` design
 * tokens. The portaled dropdown uses standard `popover-*` / main-area
 * tokens per theme-token-guidelines (DD-005).
 *
 * Framework-agnostic: all actions are expressed as callback props
 * (DD-004). The consumer bridges to their routing, auth, and theme
 * systems.
 *
 * @example
 * ```tsx
 * <UserMenu
 *   user={{ name: "Jane", email: "jane@acme.com" }}
 *   colorMode="dark"
 *   onColorModeChange={(mode) => setTheme(mode)}
 *   onSettingsClick={() => router.push("/settings")}
 *   onSignOut={() => logout()}
 * />
 * ```
 */
export function UserMenu({
  user,
  colorMode,
  onColorModeChange,
  onSettingsClick,
  onSignOut,
  extraItems,
  className,
}: UserMenuProps) {
  const showColorScheme = colorMode != null && onColorModeChange != null;
  const showSettings = onSettingsClick != null;
  const showSignOut = onSignOut != null;

  const hasContentBeforeSignOut = showSettings || showColorScheme || extraItems;

  const displayName = user?.name ?? user?.email;
  const triggerLabel = user ? "User menu" : "Settings";

  return (
    <Menu>
      <MenuTrigger
        aria-label={triggerLabel}
        className={cn(
          "stg:hover:bg-sidebar-accent stg:flex stg:w-full stg:cursor-pointer stg:items-center stg:gap-2 stg:rounded-lg stg:px-2 stg:py-1.5 stg:transition-colors stg:focus:outline-none",
          className,
        )}
      >
        <UserAvatar name={displayName} />
        {user ? (
          <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:text-left">
            {user.name && (
              <span className="stg:truncate stg:text-sm stg:font-medium">
                {user.name}
              </span>
            )}
            <span className="stg:text-sidebar-muted-foreground stg:truncate stg:text-xs">
              {user.email}
            </span>
          </div>
        ) : (
          <span className="stg:text-sidebar-muted-foreground stg:truncate stg:text-sm">
            Local mode
          </span>
        )}
        <ChevronsUpDown className="stg:text-sidebar-muted-foreground stg:ml-auto stg:size-3.5 stg:shrink-0" />
      </MenuTrigger>

      <MenuContent align="start" side="top" sideOffset={8}>
        {showSettings && (
          <MenuItem onClick={onSettingsClick}>
            <Settings className="stg:size-4" />
            Settings
          </MenuItem>
        )}

        {showSettings && showColorScheme && <MenuSeparator />}

        {showColorScheme && (
          <ColorSchemeSection
            colorMode={colorMode}
            onColorModeChange={onColorModeChange}
          />
        )}

        {extraItems && (
          <>
            {(showSettings || showColorScheme) && <MenuSeparator />}
            {extraItems}
          </>
        )}

        {showSignOut && (
          <>
            {hasContentBeforeSignOut && <MenuSeparator />}
            <MenuItem onClick={onSignOut}>
              <LogOut className="stg:size-4" />
              Sign out
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function ColorSchemeSection({
  colorMode,
  onColorModeChange,
}: {
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}) {
  return (
    <MenuGroup aria-label="Color scheme">
      <MenuLabel>
        <SunMoon className="stg:mr-1 stg:inline stg:size-3 stg:align-[-2px]" />
        Color Scheme
      </MenuLabel>
      <MenuRadioGroup
        value={colorMode}
        onValueChange={(val) => onColorModeChange(val as ColorMode)}
      >
        <MenuRadioItem value="light">Light</MenuRadioItem>
        <MenuRadioItem value="dark">Dark</MenuRadioItem>
        <MenuRadioItem value="system">System</MenuRadioItem>
      </MenuRadioGroup>
    </MenuGroup>
  );
}

function UserAvatar({ name }: { name?: string }) {
  const initial = name ? name.charAt(0).toUpperCase() : null;

  return (
    <div
      className={cn(
        "stg:bg-sidebar-accent stg:text-sidebar-accent-foreground stg:border-sidebar-border",
        "stg:flex stg:size-6 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:border",
      )}
    >
      {initial ? (
        <span className="stg:text-xs stg:font-medium">{initial}</span>
      ) : (
        <User className="stg:size-3.5" />
      )}
    </div>
  );
}
