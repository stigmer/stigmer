/**
 * Transport-layer semantic constants. Every value here was tuned in the Go
 * server against real behavior; the rationale rides with the constant so
 * nobody "fixes" one casually (coding guideline 001 §5).
 */

/**
 * Message size cap in BOTH directions, matching Go's
 * grpc.MaxRecvMsgSize/MaxSendMsgSize (backend/libs/go/grpc/server.go:94-95).
 * Skills and execution payloads approach but must not exceed this; raising
 * it silently would let one edition accept payloads the other refuses.
 */
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

/**
 * Server-initiated HTTP/2 keepalive: ping idle sessions every 15s, close if
 * the ack takes longer than 5s (Go keepalive.ServerParameters, grpc lib
 * server.go:111-114). Detects half-dead connections from suspended laptops
 * and NAT timeouts without waiting for a write to fail.
 *
 * Go additionally ENFORCES a client-ping rate floor
 * (keepalive.EnforcementPolicy MinTime 5s, server.go:102-105). Node's
 * http2 auto-acks client pings below the API surface and emits no event
 * for them, so the enforcement half is not implementable here. It is
 * protective-only (guards against ping-flooding clients) and invisible to
 * every well-behaved client — recorded as a disclosed parity nuance in the
 * sub-project record, not silently dropped.
 */
export const KEEPALIVE_PING_INTERVAL_MS = 15_000;
export const KEEPALIVE_PING_TIMEOUT_MS = 5_000;

/**
 * Graceful-shutdown drain budget, matching Go's http.Server.Shutdown
 * context timeout (backend/libs/go/grpc/server.go Stop). Order is contract:
 * health flips NOT_SERVING first, in-flight requests get up to this long,
 * then remaining connections are destroyed.
 */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Lane paths on the unified port, byte-pinned from the Go router
 * (pkg/server/server.go:812-826) and asserted by the CW-10 conformance
 * suite (test/conformance/src/suites/registry-proxy.conformance.test.ts).
 */
export const TASK_KIND_REGISTRY_PATH = "/v1/proxy/task-kind-registry";
export const MODEL_REGISTRY_PATH = "/v1/proxy/model-registry";
export const SKILL_ARTIFACTS_PATH_PREFIX = "/v1/skill-artifacts";
