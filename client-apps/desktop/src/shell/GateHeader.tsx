// The corner a pre-app gate screen shares: who is signed in, and the way out.
// The identity gate and the organization gate render it on the screens a
// person can be stuck on (an error, an onboarding form, account setup), so
// signing out never depends on getting past the gate.

import { LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

export function GateHeader() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const displayName = user.name ?? user.email;
  const initial = (displayName ?? "?").charAt(0).toUpperCase();

  return (
    <div className="absolute right-0 top-0 flex items-center gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <span className="text-xs font-medium">{initial}</span>
        </div>
        <span className="text-sm text-muted-foreground">{user.email}</span>
      </div>
      <button
        onClick={logout}
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="size-3.5" />
        Sign out
      </button>
    </div>
  );
}
