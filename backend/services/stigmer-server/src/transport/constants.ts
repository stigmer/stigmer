/**
 * Transport-layer semantic constants. Every value here is tuned against
 * real behavior; the rationale rides with the constant so nobody "fixes"
 * one casually.
 */

/**
 * Message size cap in BOTH directions. Skills and execution payloads approach but must not exceed this; raising
 * it silently would let one edition accept payloads the other refuses.
 */
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

/**
 * Server-initiated HTTP/2 keepalive: ping idle sessions every 15s, close if
 * the ack takes longer than 5s. Detects half-dead connections from suspended laptops
 * and NAT timeouts without waiting for a write to fail.
 *
 * There is no client-ping rate floor: Node's http2 auto-acks client pings
 * below the API surface and emits no event for them, so enforcement is not
 * implementable here. A floor would be protective-only (guards against
 * ping-flooding clients) and invisible to every well-behaved client.
 */
export const KEEPALIVE_PING_INTERVAL_MS = 15_000;
export const KEEPALIVE_PING_TIMEOUT_MS = 5_000;

/**
 * Graceful-shutdown drain budget. Order is contract:
 * health flips NOT_SERVING first, in-flight requests get up to this long,
 * then remaining connections are destroyed.
 */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Lane paths on the unified port, byte-pinned and asserted by the
 * conformance suite
 * test/conformance/src/suites/registry-proxy.conformance.test.ts.
 */
export const MODEL_REGISTRY_PATH = "/v1/proxy/model-registry";
export const SKILL_ARTIFACTS_PATH_PREFIX = "/v1/skill-artifacts";
/**
 * The Files transfer lane (domain/file/transfer.ts): a File's staged
 * upload and its signed download, when the File store is the local one.
 * Not `/v1/files`, which stays free for a Managed Agents files lane.
 */
export const FILE_TRANSFER_PATH_PREFIX = "/v1/file-transfer";
/** Stigmer's OAuth Client ID Metadata Document (domain/vault/sign-in/client-document.ts). */
export const OAUTH_CLIENT_DOCUMENT_PATH = "/v1/oauth/client.json";
/**
 * The Claude Managed Agents lane (managed-agents/lane.ts): a session's
 * events on Managed Agents' own paths, `/v1/sessions/{id}/events` and
 * `/v1/sessions/{id}/events/stream`. No other lane serves under it.
 */
export const MANAGED_AGENTS_PATH_PREFIX = "/v1/sessions/";
/**
 * The platform MCP lane (mcp/lane.ts): the memory, channels and
 * conversation rosters, `/v1/mcp/memory`, `/v1/mcp/channels` and
 * `/v1/mcp/conversation`, on a composition that declares
 * `servesPlatformMcp`. A runner builds these URLs from the server address
 * it already holds, for a turn whose agent program may start no local
 * MCP child: a byte-pinned path, shared with the runner.
 */
export const PLATFORM_MCP_PATH_PREFIX = "/v1/mcp/";
/**
 * The runner artifact lane (artifactstorage/runner-lane/lane.ts): a runner
 * asks for a short-lived URL on the artifact store's bucket for a key
 * under its run. Two exact paths, the runner's wire
 * (runner/src/shared/artifact-storage.ts); every other `/v1/proxy/*` path
 * stays the adapter's 404.
 */
export const RUNNER_ARTIFACT_UPLOAD_PATH = "/v1/proxy/artifacts/presigned-upload-url";
export const RUNNER_ARTIFACT_DOWNLOAD_PATH = "/v1/proxy/artifacts/presigned-download-url";

/**
 * The download lane for local artifact storage on the unified port
 * (artifactstorage/file-server.ts, createArtifactDownloadLane): the same
 * signed links the second listener serves, under one prefix, so a server
 * behind one hostname serves its files beside its console and API
 * (`ARTIFACT_LOCAL_SERVE_URL=https://<host>/artifacts`). The prefix keeps a
 * key from ever meeting a console route.
 */
export const ARTIFACT_DOWNLOAD_PATH_PREFIX = "/artifacts/";
