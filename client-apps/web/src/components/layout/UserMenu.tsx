"use client";

import { LogOut, User } from "lucide-react";
import { useAuth } from "@/auth";
import { cn } from "@stigmer/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
        "bg-muted text-muted-foreground flex items-center justify-center rounded-full",
        className,
      )}
    >
      {initial ? (
        <span className="text-xs font-medium">{initial}</span>
      ) : (
        <User className="size-4" />
      )}
    </div>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <div
        aria-label="Local mode"
        className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full"
      >
        <User className="size-4" />
      </div>
    );
  }

  const displayName = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="User menu"
        className="hover:bg-accent flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none"
      >
        <UserAvatar name={displayName} className="size-8" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="bottom" sideOffset={8}>
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            {user.name && (
              <span className="text-foreground text-sm font-medium">
                {user.name}
              </span>
            )}
            <span className="text-muted-foreground text-xs">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
