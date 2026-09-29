import { useCallback, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, AlertCircle, RefreshCw, Building2 } from "lucide-react";
import { CreateOrganizationForm, useOrgGate } from "@stigmer/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { GateHeader } from "../shell/GateHeader";

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the app until the user has at least one organization.
 *
 * Delegates the gate derivation to `useOrgGate()` from the SDK and renders
 * app-specific gate screens based on the returned state.
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const location = useLocation();

  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) =>
    location.pathname.startsWith(p),
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
