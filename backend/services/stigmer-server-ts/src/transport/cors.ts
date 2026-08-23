/**
 * CORS for the unified port's two lane families. Two deliberately different
 * policies, both ported from verified Go behavior:
 *
 * REGISTRY lanes (`registryCorsHeaders`/`handleRegistryPreflight`): the
 * byte-for-byte port of pkg/server/registry_cors.go (oss#571) —
 * `Access-Control-Allow-Origin: *` on every response; OPTIONS answered 204
 * with the fixed `GET, OPTIONS` / `Authorization, Content-Type` allow-lists.
 * Asserted by the CW-10 conformance suite.
 *
 * RPC lane (`applyRpcCors`/`isRpcPreflight`): mirrors what the Go server's
 * gRPC-Web wrapper actually does — improbable-eng/grpc-web v0.15.0 wrapping
 * rs/cors v1.7.0 with AllowOriginFunc=allow-all, AllowedHeaders=["*"],
 * AllowCredentials=true, MaxAge=600 (grpcweb/wrapper.go:70-76). Concretely:
 * the request Origin is echoed (never `*` — credentials mode), preflights
 * answer 200 with the requested method/headers echoed back, and
 * `WithCorsForRegisteredEndpointsOnly(false)` means preflights succeed for
 * ANY path, registered or not (server.go:777-784, the silent-preflight-404
 * fix).
 *
 * One ratified extension (D2 delta 2): Go only classifies a preflight as
 * gRPC-Web CORS when the requested headers include `x-grpc-web`
 * (grpcweb/wrapper.go IsAcceptableGrpcCorsRequest). The Connect protocol's
 * browser preflights carry `content-type` but not `x-grpc-web`, so under
 * Go's predicate the protocol this server ADDS would be unusable from
 * browsers. The RPC lane therefore answers every OPTIONS carrying
 * `Access-Control-Request-Method` — a strict superset of Go's behavior,
 * disclosed with the Connect delta rather than silent.
 */
import type { LaneRequest, LaneResponse } from "./lanes.js";

/** rs/cors option in the Go wrapper: 10 minutes, "pre-flights every 5s for Chromium :(". */
const RPC_PREFLIGHT_MAX_AGE_SECONDS = "600";

/** Applies the registry lanes' unconditional allow-all header (Go registryCORS). */
export function applyRegistryCorsHeaders(response: LaneResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
}

/**
 * Answers a registry-lane OPTIONS request exactly as Go's registryCORS:
 * 204 with the fixed allow-lists. Returns false for non-OPTIONS requests.
 */
export function handleRegistryPreflight(
  request: LaneRequest,
  response: LaneResponse,
): boolean {
  if (request.method !== "OPTIONS") {
    return false;
  }
  applyRegistryCorsHeaders(response);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.statusCode = 204;
  response.end();
  return true;
}

/** rs/cors preflight predicate: OPTIONS carrying Access-Control-Request-Method. */
export function isRpcPreflight(request: LaneRequest): boolean {
  return (
    request.method === "OPTIONS" &&
    typeof request.headers["access-control-request-method"] === "string"
  );
}

/**
 * Answers an RPC-lane preflight in rs/cors v1.7 shape: 200, Origin echoed,
 * requested method and headers echoed, credentials allowed, Max-Age 600.
 */
export function handleRpcPreflight(request: LaneRequest, response: LaneResponse): void {
  const origin = request.headers["origin"];
  response.setHeader("Vary", [
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ]);
  if (typeof origin === "string") {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    const requestedMethod = request.headers["access-control-request-method"];
    if (typeof requestedMethod === "string") {
      response.setHeader("Access-Control-Allow-Methods", requestedMethod.toUpperCase());
    }
    const requestedHeaders = request.headers["access-control-request-headers"];
    if (typeof requestedHeaders === "string" && requestedHeaders !== "") {
      response.setHeader("Access-Control-Allow-Headers", requestedHeaders);
    }
    response.setHeader("Access-Control-Max-Age", RPC_PREFLIGHT_MAX_AGE_SECONDS);
  }
  response.statusCode = 200;
  response.end();
}

/**
 * Stamps actual-request (non-preflight) CORS headers on an RPC-lane
 * response when the request is cross-origin: Origin echoed + credentials,
 * as rs/cors handleActualRequest does for the Go wrapper.
 */
export function applyRpcCorsHeaders(request: LaneRequest, response: LaneResponse): void {
  response.setHeader("Vary", "Origin");
  const origin = request.headers["origin"];
  if (typeof origin === "string") {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
}
