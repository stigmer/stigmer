import { getRuntimeConfig } from "@/config/runtime-config";
import type { AuthConfig, AuthMode } from "./types";

const VALID_MODES: readonly AuthMode[] = ["disabled", "oidc"];

/**
 * Resolve the auth configuration from runtime config.
 *
 * Reads `authMode` from the runtime config module (which sources values from
 * `/config.json` in containers or `NEXT_PUBLIC_*` in local dev). When the
 * mode is `oidc`, also resolves the OIDC provider parameters and validates
 * that all required fields are present.
 *
 * Defaults to `"disabled"` when the mode is unset — local OSS use works
 * out of the box with zero configuration.
 *
 * Must be called after `loadRuntimeConfig()` has resolved (enforced by
 * the `<ConfigGate>` in `Providers.tsx`).
 */
export function resolveAuthConfig(): AuthConfig {
  const config = getRuntimeConfig();
  const mode = config.authMode;

  if (!isValidAuthMode(mode)) {
    throw new Error(
      `Invalid auth mode: "${mode}". Must be one of: ${VALID_MODES.join(", ")}`,
    );
  }

  if (mode === "oidc") {
    return {
      mode: "oidc",
      oidc: {
        issuer: config.oidcIssuer,
        clientId: config.oidcClientId,
        audience: config.oidcAudience,
      },
    };
  }

  return { mode: "disabled" };
}

function isValidAuthMode(value: string): value is AuthMode {
  return (VALID_MODES as readonly string[]).includes(value);
}
