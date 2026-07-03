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
          "hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors focus:outline-none",
          className,
        )}
      >
        <UserAvatar name={displayName} />
        {user ? (
          <div className="flex min-w-0 flex-1 flex-col text-left">
            {user.name && (
              <span className="truncate text-sm font-medium">
                {user.name}
              </span>
            )}
            <span className="text-sidebar-muted-foreground truncate text-xs">
              {user.email}
            </span>
          </div>
        ) : (
          <span className="text-sidebar-muted-foreground truncate text-sm">
            Local mode
          </span>
        )}
        <ChevronsUpDown className="text-sidebar-muted-foreground ml-auto size-3.5 shrink-0" />
      </MenuTrigger>

      <MenuContent align="start" side="top" sideOffset={8}>
        {showSettings && (
          <MenuItem onClick={onSettingsClick}>
            <Settings className="size-4" />
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
              <LogOut className="size-4" />
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
        <SunMoon className="mr-1 inline size-3 align-[-2px]" />
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
        "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border",
        "flex size-6 shrink-0 items-center justify-center rounded-full border",
      )}
    >
      {initial ? (
        <span className="text-xs font-medium">{initial}</span>
      ) : (
        <User className="size-3.5" />
      )}
    </div>
  );
}
