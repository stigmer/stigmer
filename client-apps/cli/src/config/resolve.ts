// Effective-value resolution with env > config > default precedence. These are
// the settings the backend client and read verbs depend on; centralizing the
// precedence keeps every call site consistent (mirrors the Go CLI's Resolve*).
//
// All resolvers read the ACTIVE named backend (config.ts): local is the
// managed daemon (fixed endpoint, never requires auth), cloud entries carry
// the OAuth token set, selfhost entries carry an endpoint + api_key.

import { CliExitError, ExitCode } from "../errors/index.js";
import { SERVER_PORT } from "../local/constants.js";
import { type Config, activeBackend, isCloudMode } from "./config.js";

const DEFAULT_CLOUD_ENDPOINT = "api.stigmer.ai:443";
const DEFAULT_LOCAL_ENDPOINT = "localhost:7234";

/** Well-known URL for the Stigmer Cloud web console. */
export const DEFAULT_CLOUD_CONSOLE_URL = "https://app.stigmer.ai";

// Local mode is single-tenant: the seedpack bootstraps resources into the
// "stigmer" org (see client-apps/cli/src/local/seedpack/apply.ts DEFAULT_ORG).
// Org-scoped getByReference now requires an org, so bare-slug `get`/`run`/`apply`
// in local mode fall back to this default when nothing else is configured. The
// same holds for selfhost backends — they ARE the OSS server. Cloud mode has no
// implicit org — the caller must select one (flag/env/context/login).
const DEFAULT_LOCAL_ORG = "stigmer";

/**
 * Resolve the server endpoint.
 *   STIGMER_SERVER_ADDRESS   (explicit override, any backend)
 *   > the active entry's endpoint (cloud falls back to api.stigmer.ai:443)
 *   > localhost:7234          (the local daemon)
 *
 * A selfhost entry without an endpoint is a loud configuration error —
 * `config backend add` requires one, so this only happens to hand-edited
 * files, and guessing an address for a self-hosted server helps nobody.
 */
export function resolveEndpoint(config: Config): string {
  const override = process.env.STIGMER_SERVER_ADDRESS;
  if (override !== undefined && override !== "") {
    return override;
  }
  const { name, entry } = activeBackend(config);
  if (entry === undefined) {
    return DEFAULT_LOCAL_ENDPOINT;
  }
  if (entry.endpoint !== undefined && entry.endpoint !== "") {
    return entry.endpoint;
  }
  if (entry.type === "cloud") {
    return DEFAULT_CLOUD_ENDPOINT;
  }
  throw new CliExitError(
    `backend "${name}" has no endpoint configured`,
    ExitCode.Usage,
    [
      `Re-add it with one:`,
      `  stigmer config backend add ${name} --endpoint <host:port>`,
    ],
  );
}

/**
 * Resolve the auth token.
 *   STIGMER_API_KEY   (env, also where the --api-key global is bridged)
 *   > the active entry's credential (cloud: login token; selfhost: api_key)
 *   > ""              (unauthenticated)
 */
export function resolveToken(config: Config): string {
  const env = process.env.STIGMER_API_KEY;
  if (env !== undefined && env !== "") {
    return env;
  }
  const { entry } = activeBackend(config);
  if (entry === undefined) {
    return "";
  }
  return (entry.type === "cloud" ? entry.token : entry.api_key) ?? "";
}

/**
 * Resolve the active organization.
 *   --org flag override > STIGMER_ORG_ID env > context.organization
 *   > the active entry's org_id (legacy fallback)
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
  // Nothing configured: local and selfhost fall back to the single-tenant
  // default org so bare-slug operations resolve without ceremony; cloud
  // stays empty (the caller must select an org, e.g. apply raises a clear
  // "organization not set").
  return isCloudMode(config) ? "" : DEFAULT_LOCAL_ORG;
}

/**
 * Resolve the web console URL:
 *   1. `STIGMER_CONSOLE_URL` (explicit override)
 *   2. local daemon → `http://localhost:{SERVER_PORT}` — the server's own
 *      unified port serves the console since DD-012 (one origin for UI and
 *      API; the Go-era separate 8234 listener is retired)
 *   3. selfhost → the entry's endpoint on the same one-origin rule
 *      (https for :443, http otherwise)
 *   4. cloud → {@link DEFAULT_CLOUD_CONSOLE_URL}
 *
 * The console origin is also the app origin that serves the hosted chat
 * page (`/chat/<org>/<slug>`) and the embed loader (`/embed.js`), so
 * share-link builders use this same resolver — both routes live in the
 * same static export the server serves.
 */
export function resolveConsoleURL(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.STIGMER_CONSOLE_URL;
  if (override !== undefined && override !== "") return override;
  const { entry } = activeBackend(config);
  if (entry === undefined) return `http://localhost:${SERVER_PORT}`;
  if (entry.type === "selfhost") {
    const endpoint = entry.endpoint ?? "";
    const scheme = endpoint.endsWith(":443") ? "https" : "http";
    return `${scheme}://${endpoint.replace(/:443$/, "")}`;
  }
  return DEFAULT_CLOUD_CONSOLE_URL;
}

/**
 * The configured organization, with the active entry's org_id fallback.
 * Reports only what is explicitly set (no implicit local default) so
 * config/context display can faithfully show "(not set)".
 */
export function resolveContextOrganization(config: Config): string {
  if (
    config.context?.organization !== undefined &&
    config.context.organization !== ""
  ) {
    return config.context.organization;
  }
  return activeBackend(config).entry?.org_id ?? "";
}

/**
 * Fail fast with a clear "please log in" error when a CLOUD command has no
 * usable credential. The local daemon never requires auth. Selfhost
 * backends are deliberately not gated client-side: an unauthenticated
 * self-host (no issuer configured) is a legitimate posture, and an
 * authenticated one answers UNAUTHENTICATED with a clear message — the
 * server owns that decision. A credential is any of: the STIGMER_API_KEY
 * env (or bridged --api-key), a persisted access token, or a refresh token
 * (which the token provider can exchange for a fresh access token).
 */
export function ensureAuthenticated(config: Config): void {
  const { entry } = activeBackend(config);
  if (entry?.type !== "cloud") return;
  if (process.env.STIGMER_API_KEY) return;
  if (entry.token || entry.refresh_token) return;
  throw new CliExitError("Not authenticated", ExitCode.Auth, [
    "Please sign in:",
    "  stigmer auth login",
  ]);
}
