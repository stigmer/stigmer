"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Building2,
  LogOut,
} from "lucide-react";
import { CreateOrganizationForm, useOrgGate } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useAuth } from "@/auth";

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the application shell until the user has at least one organization.
 *
 * Delegates the gate derivation to `useOrgGate()` from the SDK and renders
 * Console-specific gate screens based on the returned state. The list the
 * gate reads is final by the time it renders (the identity gate ahead of
 * it has already provisioned whatever the server provisions), so an empty
 * list goes straight to onboarding — on Stigmer Cloud and on a self-hosted
 * server alike.
 *
 * Certain routes (e.g. `/invite/[token]`) bypass the gate because the
 * user may not have an org yet — they are joining one via an invitation.
 *
 * This is a Console-only concern — platform builders handle org provisioning
 * in their own onboarding flows.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) =>
    pathname.startsWith(p),
  );

  const { state, retry, refresh } = useOrgGate({ isBypassed });

  switch (state.status) {
    case "bypassed":
    case "ready":
      return <>{children}</>;
    case "loading":
      return <LoadingState />;
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
        className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
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
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <Building2 className="text-muted-foreground size-6" />
          </div>
          <h1 className="text-foreground text-lg font-semibold">
            Welcome to Stigmer
          </h1>
          <p className="text-muted-foreground text-sm">
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
