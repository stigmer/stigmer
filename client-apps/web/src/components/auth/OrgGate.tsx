"use client";

import { useCallback } from "react";
import { Loader2, AlertCircle, RefreshCw, Building2, LogOut } from "lucide-react";
import { CreateOrganizationForm } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrg } from "@/contexts/org-context";
import { useAuth } from "@/auth";

/**
 * Blocks the application shell until the user has at least one organization.
 *
 * Sits between {@link OrgProvider} and the app content in the provider
 * hierarchy. Handles three pre-app states:
 *
 * - **Loading** — spinner while `findMyOrganizations()` is in flight.
 * - **Error** — retry prompt when the org fetch fails.
 * - **No organizations** — onboarding screen with inline
 *   {@link CreateOrganizationForm} from `@stigmer/react`.
 *
 * Once at least one org exists, renders `children` (the normal AppShell).
 *
 * This is a Console-only concern — platform builders handle org provisioning
 * in their own onboarding flows.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const { orgs, isLoading, error, retry, refresh } = useOrg();

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }

  if (orgs.length === 0) {
    return <OnboardingState onRefresh={refresh} />;
  }

  return <>{children}</>;
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
