import type { AuthConfig, AuthMode } from "./types";

const VALID_MODES: readonly AuthMode[] = ["disabled", "oidc"];

/**
 * Resolve the auth configuration from environment variables.
 *
 * Reads `NEXT_PUBLIC_AUTH_MODE` and validates it against the supported modes.
 * Defaults to `"disabled"` when the variable is unset — this makes local OSS
 * use work out of the box with zero configuration.
 *
 * When the Go server's `/api/config` endpoint is introduced (T05), this
 * function can be extended to prefer runtime config over env vars without
 * changing the auth abstraction.
 */
export function resolveAuthConfig(): AuthConfig {
  const raw = process.env.NEXT_PUBLIC_AUTH_MODE ?? "disabled";
  const mode = raw.trim().toLowerCase();

  if (!isValidAuthMode(mode)) {
    throw new Error(
      `Invalid NEXT_PUBLIC_AUTH_MODE: "${raw}". Must be one of: ${VALID_MODES.join(", ")}`,
    );
  }

  return { mode };
}

function isValidAuthMode(value: string): value is AuthMode {
  return (VALID_MODES as readonly string[]).includes(value);
}
