"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { Loader2, AlertCircle, RefreshCw, Building2, LogOut } from "lucide-react";
import { CreateOrganizationForm, useOrgGate } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useAuth } from "@/auth";
import { getRuntimeConfig } from "@/config/runtime-config";

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the application shell until the user has at least one organization.
 *
 * Delegates provisioning state machine logic to `useOrgGate()` from the
 * SDK and renders Console-specific gate screens based on the returned state.
 *
 * Certain routes (e.g. `/invite/[token]`) bypass the gate because the
 * user may not have an org yet — they are joining one via an invitation.
 *
 * This is a Console-only concern — platform builders handle org provisioning
 * in their own onboarding flows.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) => pathname.startsWith(p));

  const { state, retry, refresh } = useOrgGate({
    isBypassed,
    isOidcMode: getRuntimeConfig().authMode === "oidc",
  });

  switch (state.status) {
    case "bypassed":
    case "ready":
      return <>{children}</>;
    case "loading":
      return <LoadingState />;
    case "provisioning":
      return <ProvisioningState />;
    case "error":
      return <ErrorState message={state.message} onRetry={retry} />;
    case "no-orgs":
      return <OnboardingState onRefresh={refresh} />;
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
// Provisioning — waiting for server-side personal org creation (OIDC only)
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
            Setting up your workspace&hellip;
          </p>
        </div>
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
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
        Failed to load organizations
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

// ---------------------------------------------------------------------------
// Onboarding — first-time user, no organizations
// ---------------------------------------------------------------------------

function OnboardingState({
  onRefresh,
}: {
  onRefresh: (targetSlug?: string) => void;
}) {
  const handleCreated = useCallback(
    (org: Organization) => {
      onRefresh(org.metadata?.slug);
    },
    [onRefresh],
  );

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-8">
      <GateHeader />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Building2 className="text-muted-foreground size-6" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            Welcome to Stigmer
          </h1>
          <p className="text-sm text-muted-foreground">
            Create an organization to get started. Organizations are the
            top-level context that owns your agents, environments, and
            resources.
          </p>
        </div>

        <CreateOrganizationForm onCreated={handleCreated} />
      </div>
    </div>
  );
}
