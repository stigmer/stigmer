// The corner a pre-app gate screen shares: who is signed in, and the way out.
// The identity gate and the organization gate pass it to the kit's gate
// views, which place it top-right on the screens a person can be stuck on
// (an error, an onboarding form, account setup), so signing out never
// depends on getting past the gate.

import { LogOut } from "lucide-react";
import { Button } from "@stigmer/react-sdk";
import { useAuth } from "../auth/AuthProvider";

export function GateHeader() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const displayName = user.name ?? user.email;
  const initial = (displayName ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <span className="text-xs font-medium">{initial}</span>
        </div>
        <span className="text-sm text-muted-foreground">{user.email}</span>
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
