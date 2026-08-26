/**
 * Artifact domain constants — byte-pinned values and wire copy from
 * pkg/domain/artifact. The error formats are asserted by the conformance
 * suite (get NotFound copy, deleted-blob copy) and shown verbatim by
 * clients — never reword.
 */

/** Go kind string on the built resource. */
export const ARTIFACT_KIND = "Artifact";

/**
 * Go maxContentBytes (50 MB): the domain-level content cap →
 * ResourceExhausted. Sits BEHIND the transport's 10MB message cap, so it
 * is not wire-assertable from the reference client — the arm stays
 * unit-level in both editions (the wave-2 S1 amendment).
 */
export const MAX_CONTENT_BYTES = 50 * 1024 * 1024;

/** Go defaultTTLDays: expires_at defaults ~30 days out. */
export const DEFAULT_TTL_DAYS = 30;

/** Go permanentTTLMarker: retention.ttl_days = -1 means never expires. */
export const PERMANENT_TTL_MARKER = -1;

/**
 * Go DefaultMaxContentBytes (512 KB): getContent's default/implicit cap,
 * matching AgentExecutionController.GetArtifactContent so the two
 * content-read endpoints behave identically from a client's perspective.
 */
export const DEFAULT_MAX_CONTENT_BYTES = 512n * 1024n;

/**
 * Go downloadURLExpiration (7 days — the R2 maximum). Reported as
 * ttl_seconds UNCONDITIONALLY, even by the local backend whose URLs never
 * expire — the ratified P3 wire pin.
 */
export const DOWNLOAD_URL_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Go: status.Errorf(codes.NotFound, "Artifact not found: %s", id). */
export function artifactNotFoundMessage(artifactId: string): string {
  return `Artifact not found: ${artifactId}`;
}

/** Go: "artifact blob has been deleted: %s" (FailedPrecondition). */
export function artifactBlobDeletedMessage(artifactId: string): string {
  return `artifact blob has been deleted: ${artifactId}`;
}
