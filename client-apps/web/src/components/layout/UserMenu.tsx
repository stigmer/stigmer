"use client";

import { useSyncExternalStore } from "react";
import { LogOut, User, ChevronsUpDown, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/auth";
import { cn } from "@stigmer/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
        "bg-muted text-muted-foreground border-border flex shrink-0 items-center justify-center rounded-full border",
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

  const themeLabel = mounted && theme
    ? theme.charAt(0).toUpperCase() + theme.slice(1)
    : "";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SunMoon className="size-4" />
        Appearance
        {themeLabel && (
          <span className="text-muted-foreground ml-auto mr-1 text-xs">
            {themeLabel}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={(val) => setTheme(val as string)}
        >
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
          <div className="bg-muted border-border flex size-6 shrink-0 items-center justify-center rounded-full border">
            <User className="size-3.5" />
          </div>
          <span className="text-muted-foreground truncate text-sm">
            Local mode
          </span>
          <ChevronsUpDown className="text-muted-foreground ml-auto size-3.5 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" sideOffset={8}>
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
          <span className="text-muted-foreground truncate text-xs">
            {user.email}
          </span>
        </div>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" sideOffset={8}>
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
