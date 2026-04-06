"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { LogOut, Settings, User, ChevronsUpDown, SunMoon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/auth";
import { cn, THEME_PRESETS, resolvePresetClass } from "@stigmer/theme";
import type { ThemePresetId } from "@stigmer/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const noopSubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const PRESET_STORAGE_KEY = "stgm-theme-preset";
const PRESET_CLASSES = THEME_PRESETS.map((p) => p.className).filter(Boolean);

function usePresetId(): [ThemePresetId, (id: ThemePresetId) => void] {
  const mounted = useMounted();
  const [presetId, setPresetIdState] = useState<ThemePresetId>(() => {
    if (typeof window === "undefined") return "default";
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    if (stored && THEME_PRESETS.some((p) => p.id === stored)) {
      return stored as ThemePresetId;
    }
    return "default";
  });

  useEffect(() => {
    if (!mounted) return;
    const el = document.documentElement;
    for (const cls of PRESET_CLASSES) {
      el.classList.remove(cls);
    }
    const active = resolvePresetClass(presetId);
    if (active) el.classList.add(active);
  }, [presetId, mounted]);

  const setPresetId = useCallback((id: ThemePresetId) => {
    setPresetIdState(id);
    localStorage.setItem(PRESET_STORAGE_KEY, id);
  }, []);

  return [presetId, setPresetId];
}

function UserAvatar({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const initial = name ? name.charAt(0).toUpperCase() : null;

  return (
    <div
      className={cn(
        "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border flex shrink-0 items-center justify-center rounded-full border",
        className,
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

function AppearanceSubmenu() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [presetId, setPresetId] = usePresetId();

  const themeLabel = mounted && theme
    ? theme.charAt(0).toUpperCase() + theme.slice(1)
    : "";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SunMoon className="size-4" />
        Appearance
        {themeLabel && (
          // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- renders in portaled DropdownMenuContent
          <span className="text-muted-foreground ml-auto mr-1 text-xs">
            {themeLabel}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Color Scheme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={(val) => setTheme(val as string)}
          >
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={presetId}
            onValueChange={(val) => setPresetId(val as ThemePresetId)}
          >
            {THEME_PRESETS.map((preset) => (
              <DropdownMenuRadioItem key={preset.id} value={preset.id}>
                <span
                  // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- portaled DropdownMenuContent
                  className="size-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: preset.swatch }}
                />
                {preset.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SettingsItem() {
  const router = useRouter();
  return (
    <DropdownMenuItem onClick={() => router.push("/settings")}>
      <Settings className="size-4" />
      Settings
    </DropdownMenuItem>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Settings"
          className="hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors focus:outline-none"
        >
          <div className="bg-sidebar-accent border-sidebar-border flex size-6 shrink-0 items-center justify-center rounded-full border">
            <User className="size-3.5" />
          </div>
          <span className="text-sidebar-muted-foreground truncate text-sm">
            Local mode
          </span>
          <ChevronsUpDown className="text-sidebar-muted-foreground ml-auto size-3.5 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" sideOffset={8}>
          <SettingsItem />
          <AppearanceSubmenu />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const displayName = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="User menu"
        className="hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors focus:outline-none"
      >
        <UserAvatar name={displayName} className="size-6" />
        <div className="flex min-w-0 flex-1 flex-col text-left">
          {user.name && (
            <span className="truncate text-sm font-medium">{user.name}</span>
          )}
          <span className="text-sidebar-muted-foreground truncate text-xs">
            {user.email}
          </span>
        </div>
        <ChevronsUpDown className="text-sidebar-muted-foreground size-3.5 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" sideOffset={8}>
        <SettingsItem />
        <AppearanceSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
