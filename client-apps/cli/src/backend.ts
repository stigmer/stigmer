// Composition root for the backend client.
//
// `createBackendClient` (the client module) is deliberately auth-agnostic; this
// is the one place that injects the refreshing token provider so every command
// gets silent token refresh without the client module depending on auth. Keep
// this as the single entry point commands use to reach the backend.

import { createRefreshingTokenProvider } from "./auth/token.js";
import { type BackendClient, createBackendClient } from "./client/index.js";
import { type Config, load } from "./config/index.js";

/** Build a backend client for the given (or on-disk) config, with auto-refresh. */
export function connectBackend(config: Config = load()): BackendClient {
  return createBackendClient({ config, getAccessToken: createRefreshingTokenProvider(config) });
}
