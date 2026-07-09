// ---------------------------------------------------------------------------
// Environment accessors — public API for application configuration
//
// These functions provide the stable interface that the rest of the app uses
// (StigmerTransportBridge, auth config, etc.). Internally they delegate to
// the runtime config module, which resolves values from /config.json
// (container deployment) or NEXT_PUBLIC_* env vars (local dev).
//
// Callers do not need to know where the values come from.
// ---------------------------------------------------------------------------

import { getRuntimeConfig } from "./runtime-config";

export function getApiBaseUrl(): string {
  return getRuntimeConfig().apiUrl;
}

/**
 * Public web app base URL for externally shareable links (no trailing
 * slash). Falls back to the browser's own origin when not configured —
 * correct whenever the app is served at its public URL.
 */
export function getAppBaseUrl(): string {
  const configured = getRuntimeConfig().appUrl;
  if (configured) return configured.replace(/\/$/, "");
  return window.location.origin;
}

export function getIamApiAudience(): string {
  return getRuntimeConfig().oidcAudience;
}
