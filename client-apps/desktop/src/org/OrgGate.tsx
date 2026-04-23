import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Building2,
  LogOut,
} from "lucide-react";
import { CreateOrganizationForm } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrg } from "./OrgProvider";
import { useAuth } from "../auth/AuthProvider";

const PROVISIONING_POLL_MS = 2_000;
const PROVISIONING_TIMEOUT_MS = 10_000;

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the app until the user has at least one organization.
 *
 * Desktop port of the web's OrgGate, adapted for react-router.
 * Handles: loading, provisioning poll (OIDC), error+retry, and
 * onboarding with `CreateOrganizationForm` from the SDK.
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const { orgs, isLoading, error, retry, refresh } = useOrg();
  const location = useLocation();
  const { user } = useAuth();
  const [provisioningStarted, setProvisioningStarted] = useState(false);
  const [provisioningTimedOut, setProvisioningTimedOut] = useState(false);

  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) =>
    location.pathname.startsWith(p),
  );

  const isOidcMode = user !== null;

  if (
    !isBypassed &&
    !provisioningStarted &&
    !isLoading &&
    orgs.length === 0 &&
    !error &&
    isOidcMode
  ) {
    setProvisioningStarted(true);
  }

  const isProvisioning =
    provisioningStarted && orgs.length === 0 && !provisioningTimedOut;

  useEffect(() => {
    if (!isProvisioning) return;

    const interval = setInterval(() => refresh(), PROVISIONING_POLL_MS);
    const timeout = setTimeout(
      () => setProvisioningTimedOut(true),
      PROVISIONING_TIMEOUT_MS,
    );

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isProvisioning, refresh]);

  if (isBypassed) return <>{children}</>;
  if (isProvisioning) return <ProvisioningState />;
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (orgs.length === 0) return <OnboardingState onRefresh={refresh} />;

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Gate header — user identity + sign-out
// ---------------------------------------------------------------------------

function GateHeader() {
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

// ---------------------------------------------------------------------------
// Provisioning — waiting for server-side personal org creation (OIDC)
// ---------------------------------------------------------------------------

function ProvisioningState() {
  const { user } = useAuth();
  const displayName = user?.name ?? user?.email;

  return (
    <div className="relative flex h-screen flex-col items-center justify-center p-8 bg-background text-foreground">
      <GateHeader />
      <div className="flex flex-col items-center gap-4 text-center">
        {user && (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <span className="text-lg font-medium text-muted-foreground">
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
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center gap-4 p-8 bg-background text-foreground">
      <GateHeader />
      <AlertCircle className="size-8 text-destructive" />
      <p className="text-sm font-medium text-destructive">
        Failed to load organizations
      </p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
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
    <div className="relative flex h-screen flex-col items-center justify-center p-8 bg-background text-foreground">
      <GateHeader />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Building2 className="size-6 text-muted-foreground" />
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
