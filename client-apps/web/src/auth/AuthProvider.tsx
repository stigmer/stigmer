"use client";

import { lazy, Suspense, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { resolveAuthConfig } from "./config";
import { DisabledAuthProvider } from "./disabled/DisabledAuthProvider";

const OidcAuthProvider = lazy(() => import("./oidc/OidcAuthProvider"));

/**
 * Top-level auth provider that delegates to the mode-specific implementation.
 *
 * Reads the auth config from the runtime config module (populated by
 * `<ConfigGate>` before this component mounts) and renders the
 * corresponding provider:
 *
 * - `disabled` → `DisabledAuthProvider` (inline, zero-cost for OSS)
 * - `oidc` → `OidcAuthProvider` (lazy-loaded, keeps the disabled-mode
 *   bundle lean — the OIDC provider and `oidc-client-ts` are only
 *   downloaded when the auth mode is `oidc`)
 *
 * The config is resolved once via `useMemo` (not at module scope) because
 * it depends on the runtime config which is loaded asynchronously by
 * `<ConfigGate>` before this component renders.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const config = useMemo(() => resolveAuthConfig(), []);

  switch (config.mode) {
    case "disabled":
      return <DisabledAuthProvider>{children}</DisabledAuthProvider>;

    case "oidc":
      return (
        <Suspense fallback={<AuthSuspenseFallback />}>
          <OidcAuthProvider config={config.oidc}>
            {children}
          </OidcAuthProvider>
        </Suspense>
      );
  }
}

function AuthSuspenseFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
    </div>
  );
}
