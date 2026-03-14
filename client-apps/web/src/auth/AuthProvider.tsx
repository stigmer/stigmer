"use client";

import { resolveAuthConfig } from "./config";
import { DisabledAuthProvider } from "./disabled/DisabledAuthProvider";

const config = resolveAuthConfig();

/**
 * Top-level auth provider that delegates to the mode-specific implementation.
 *
 * Reads the auth config once at module initialization and renders the
 * corresponding provider. The config is resolved from environment variables
 * (see `config.ts`).
 *
 * When OIDC mode is implemented, this component will dynamically import
 * the OIDC provider to keep the disabled-mode bundle lean.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  switch (config.mode) {
    case "disabled":
      return <DisabledAuthProvider>{children}</DisabledAuthProvider>;

    case "oidc":
      throw new Error(
        "OIDC auth mode is not yet implemented. " +
          "Set NEXT_PUBLIC_AUTH_MODE=disabled or omit it for local use.",
      );
  }
}
