// ---------------------------------------------------------------------------
// Well-known Stigmer platform environment variable keys
//
// A platform value comes from the component that knows it, fills only a key
// that is still missing, and reaches only a server that declares it
// (stigmer/stigmer#1446). The page is not that component for any key, so
// this SDK supplies none: a value it wrote into a run's runtime env would
// sit in the top merge layer, above every value a user saved, and a run
// whose agent declares no env would carry it into the agent's shell.
//
// STIGMER_SERVER_ADDRESS is the one key the platform fills. The runner
// writes it for a server that declares it and holds no value: from the
// server's public address, which the server hands every sandbox it
// provisions, or for a stdio child from the endpoint the runner dials
// itself (backend/services/runner, the platform-server-address module).
//
// STIGMER_API_KEY is not a platform key. A server that calls the Stigmer
// API declares it like any other secret, and its user saves an API key for
// it; nothing hands a user-defined server the signed-in user's bearer.
// ---------------------------------------------------------------------------

/**
 * Environment variable keys the platform fills itself, so the setup hooks
 * never prompt a user for them and the credential forms never ask for them.
 *
 * Platform builders who manage setup hooks directly can use this set to
 * extend their own `poolKeys`.
 */
export const SYSTEM_ENV_VAR_KEYS: ReadonlySet<string> = new Set([
  "STIGMER_SERVER_ADDRESS",
]);
