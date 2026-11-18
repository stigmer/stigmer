"use client";

// The corner the console's gate screens share: who is signed in, and Sign
// out, so a person stuck at a gate (setting up their account, a failure,
// making their first organization) can always leave. The kit's gate views
// place it top-right; the identity gate and the organization gate pass it.

import { LogOut } from "lucide-react";
import { Button } from "@stigmer/react-sdk";
import { useAuth } from "@/auth";

export function GateAccount() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const displayName = user.name ?? user.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
          <span className="text-xs font-medium">{initial}</span>
        </div>
        <span className="text-muted-foreground text-sm">{user.email}</span>
      </div>
      <Button
        variant="ghost"
        icon={<LogOut className="size-3.5" />}
        onClick={logout}
        className="text-muted-foreground hover:text-foreground"
      >
        Sign out
      </Button>
    </div>
  );
}
