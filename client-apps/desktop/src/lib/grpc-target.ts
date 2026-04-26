const DEFAULT_GRPC_PORT = "443";
const LOCAL_GRPC_PORT = "7234";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Convert an HTTP base URL (e.g. `https://api.stigmer.ai`) into a gRPC
 * target string (e.g. `api.stigmer.ai:443`).
 *
 * The Go SDK's `WithBaseURL` passes the target directly to
 * `grpc.NewClient`, which expects `host:port` — not a URL with a scheme.
 */
export function toGrpcTarget(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  const host = url.hostname;
  if (url.port) return `${host}:${url.port}`;

  const isLocal = LOCAL_HOSTS.has(host);
  return `${host}:${isLocal ? LOCAL_GRPC_PORT : DEFAULT_GRPC_PORT}`;
}
