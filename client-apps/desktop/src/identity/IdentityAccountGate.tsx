// The desktop's first-sign-in gate: the person's identity account exists
// before the app asks the server for anything that belongs to them. On a
// first sign-in the server does not know the person yet, so the gate
// provisions their account (and, on Stigmer Cloud, their personal
// organization with it), the same step the web console and
// `stigmer auth login` run.

import type { ReactNode } from "react";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useIdentityAccountGate } from "@stigmer/react";
import { useAuth } from "../auth/AuthProvider";
import { GateHeader } from "../shell/GateHeader";

/**
 * Blocks the app until the caller's identity account is resolved, or
 * provisioned on a first sign-in.
 *
 * Delegates the whoAmI / provisionMyAccount state machine to
 * `useIdentityAccountGate()` from the SDK and renders the desktop's gate
 * screens for each state, as the web console's gate does. With auth
 * disabled (a local server) the hook reports ready at once.
 *
 * It sits above `OrgProvider` in the provider chain, so the personal
 * organization exists before `findMyOrganizations()` is called.
 */
export function IdentityAccountGate({ children }: { children: ReactNode }) {
  const { isAuthEnabled } = useAuth();
  const { state, retry } = useIdentityAccountGate({ isEnabled: isAuthEnabled });

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

function CheckingState() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

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
            Setting up your account&hellip;
          </p>
        </div>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
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
        Failed to set up your account
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
