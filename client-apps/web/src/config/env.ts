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

export function getIamApiAudience(): string {
  return getRuntimeConfig().oidcAudience;
}
