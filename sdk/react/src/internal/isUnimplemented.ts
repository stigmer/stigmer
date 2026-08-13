/**
 * Detect gRPC/Connect UNIMPLEMENTED (code 12) from any error the SDK
 * client can throw.
 *
 * UNIMPLEMENTED is how the shared SDK discovers edition capabilities:
 * the OSS server deliberately leaves hosted-only RPCs unimplemented
 * (e.g. the org-OAuth-app override surface, stigmer/stigmer#558), and
 * hooks probe for it to degrade gracefully instead of surfacing an
 * error. The SDK's generated CODE_MAP does not include Unimplemented —
 * a `StigmerError` wrapping one reports `code: "unknown"` — so
 * detection must go through `connectCode` (or the message shapes used
 * by transports that never produce a structured error).
 *
 * @internal
 */
export function isUnimplemented(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (
    "connectCode" in err &&
    (err as { connectCode: unknown }).connectCode === 12
  ) {
    return true;
  }
  const msg = (err as { message?: string }).message ?? "";
  return msg.includes("[unimplemented]") || msg.includes("UNIMPLEMENTED");
}
