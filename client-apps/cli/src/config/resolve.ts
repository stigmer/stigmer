// Effective-value resolution with env > config > default precedence. These are
// the settings the backend client and read verbs depend on; centralizing the
// precedence keeps every call site consistent (mirrors the Go CLI's Resolve*).

import { CliExitError, ExitCode } from "../errors/index.js";
import { WEB_CONSOLE_PORT } from "../local/constants.js";
import { type BackendType, type Config, isCloudMode } from "./config.js";

const DEFAULT_CLOUD_ENDPOINT = "api.stigmer.ai:443";
const DEFAULT_LOCAL_ENDPOINT = "localhost:7234";

/** Well-known URL for the Stigmer Cloud web console. */
export const DEFAULT_CLOUD_CONSOLE_URL = "https://app.stigmer.ai";

// Local mode is single-tenant: the seedpack bootstraps resources into the
// "stigmer" org (see client-apps/cli/src/local/seedpack/apply.ts DEFAULT_ORG).
// Org-scoped getByReference now requires an org, so bare-slug `get`/`run`/`apply`
// in local mode fall back to this default when nothing else is configured. Cloud
// mode has no implicit org — the caller must select one (flag/env/context/login).
const DEFAULT_LOCAL_ORG = "stigmer";

/**
 * Resolve the server endpoint.
 *   STIGMER_SERVER_ADDRESS  (explicit override, either backend)
 *   > cloud.endpoint        (cloud mode)
 *   > api.stigmer.ai:443    (cloud default) / localhost:7234 (local default)
 */
export function resolveEndpoint(config: Config): string {
  const override = process.env.STIGMER_SERVER_ADDRESS;
  if (override !== undefined && override !== "") {
    return override;
  }
  if (isCloudMode(config)) {
    return config.backend.cloud?.endpoint || DEFAULT_CLOUD_ENDPOINT;
  }
  return DEFAULT_LOCAL_ENDPOINT;
}

/**
 * Resolve the auth token.
 *   STIGMER_API_KEY  (env, also where the --api-key global is bridged)
 *   > cloud.token    (persisted login token)
 *   > ""             (unauthenticated)
 */
export function resolveToken(config: Config): string {
  const env = process.env.STIGMER_API_KEY;
  if (env !== undefined && env !== "") {
    return env;
  }
  return config.backend.cloud?.token ?? "";
}

/**
 * Resolve the active organization.
 *   --org flag override > STIGMER_ORG_ID env > context.organization
 *   > cloud.org_id (legacy fallback)
 */
export function resolveOrganization(config: Config, flagOrg?: string): string {
  if (flagOrg !== undefined && flagOrg !== "") {
    return flagOrg;
  }
  const env = process.env.STIGMER_ORG_ID;
  if (env !== undefined && env !== "") {
    return env;
  }
  const context = resolveContextOrganization(config);
  if (context !== "") {
    return context;
  }
  // Nothing configured: local mode falls back to its single-tenant default org
  // so bare-slug operations resolve without ceremony; cloud stays empty (the
  // caller must select an org, e.g. apply raises a clear "organization not set").
  return isCloudMode(config) ? "" : DEFAULT_LOCAL_ORG;
}

/**
 * Resolve the web console URL:
 *   1. `STIGMER_CONSOLE_URL` (explicit override)
 *   2. local backend → `http://localhost:{WEB_CONSOLE_PORT}`
 *   3. cloud backend → {@link DEFAULT_CLOUD_CONSOLE_URL}
 *
 * The console origin is also the app origin that serves the hosted chat
 * page (`/chat/<org>/<slug>`) and the embed loader (`/embed.js`), so
 * share-link builders use this same resolver.
 */
export function resolveConsoleURL(backendType: BackendType, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STIGMER_CONSOLE_URL;
  if (override !== undefined && override !== "") return override;
  if (backendType === "local") return `http://localhost:${WEB_CONSOLE_PORT}`;
  return DEFAULT_CLOUD_CONSOLE_URL;
}

/**
 * The configured organization, with the legacy cloud.org_id fallback. Reports
 * only what is explicitly set (no implicit local default) so config/context
 * display can faithfully show "(not set)".
 */
export function resolveContextOrganization(config: Config): string {
  if (config.context?.organization !== undefined && config.context.organization !== "") {
    return config.context.organization;
  }
  return config.backend.cloud?.org_id ?? "";
}

/**
 * Fail fast with a clear "please log in" error when a cloud command has no
 * usable credential. Local mode never requires auth. A credential is any of:
 * the STIGMER_API_KEY env (or bridged --api-key), a persisted access token, or
 * a refresh token (which the token provider can exchange for a fresh access
 * token). This lives in the config layer — not the client façade — because it
 * is purely a question of which credentials are configured.
 */
export function ensureAuthenticated(config: Config): void {
  if (!isCloudMode(config)) return;
  if (process.env.STIGMER_API_KEY) return;
  const cloud = config.backend.cloud;
  if (cloud?.token || cloud?.refresh_token) return;
  throw new CliExitError("Not authenticated", ExitCode.Auth, ["Please sign in:", "  stigmer auth login"]);
}
