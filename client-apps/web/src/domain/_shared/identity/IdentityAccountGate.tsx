"use client";

import { Loader2, AlertCircle, RefreshCw, LogOut } from "lucide-react";
import { useIdentityAccountGate } from "@stigmer/react";
import { useAuth } from "@/auth";
import { getRuntimeConfig } from "@/config/runtime-config";

/**
 * Blocks the application shell until the caller's identity account is
 * resolved (or provisioned for first-time signups).
 *
 * Delegates the whoAmI / provisionMyAccount state machine to
 * `useIdentityAccountGate()` from the SDK and renders Console-specific
 * gate screens based on the returned state.
 *
 * Disabled-auth deployments bypass the gate entirely — the hook receives
 * `isEnabled: false` and immediately reports ready.
 *
 * This gate sits between StigmerTransportBridge and OrgProvider in the
 * provider chain so that the identity account (and personal org) exist
 * before `findMyOrganizations()` is called.
 */
export function IdentityAccountGate({ children }: { children: React.ReactNode }) {
  const { state, retry } = useIdentityAccountGate({
    isEnabled: getRuntimeConfig().authMode === "oidc",
  });

  switch (state.status) {
    case "ready":
      return <>{children}</>;
    case "checking":
      return <CheckingState />;
    case "provisioning":
      return <ProvisioningState />;
    case "error":
      return <ErrorState message={state.message} onRetry={retry} />;
  }
}

// ---------------------------------------------------------------------------
// Gate header — user identity + sign-out for pre-app screens
// ---------------------------------------------------------------------------

function GateHeader() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const displayName = user.name ?? user.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="absolute top-0 right-0 flex items-center gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
          <span className="text-xs font-medium">{initial}</span>
        </div>
        <span className="text-muted-foreground text-sm">{user.email}</span>
      </div>
      <button
        onClick={logout}
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm transition-colors"
      >
        <LogOut className="size-3.5" />
        Sign out
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checking — resolving identity via whoAmI
// ---------------------------------------------------------------------------

function CheckingState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provisioning — creating identity account for first-time signup
// ---------------------------------------------------------------------------

function ProvisioningState() {
  const { user } = useAuth();
  const displayName = user?.name ?? user?.email;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-8">
      <GateHeader />
      <div className="flex flex-col items-center gap-4 text-center">
        {user && (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <span className="text-muted-foreground text-lg font-medium">
              {(displayName ?? "?").charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-foreground">
            {displayName ? `Welcome, ${displayName}!` : "Welcome!"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Setting up your account&hellip;
          </p>
        </div>
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <GateHeader />
      <AlertCircle className="text-destructive size-8" />
      <p className="text-destructive text-sm font-medium">
        Failed to set up your account
      </p>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <RefreshCw className="size-3" />
        Try again
      </button>
    </div>
  );
}
