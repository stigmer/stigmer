/**
 * The runner artifact lane's key and content-type rules, and the run a key
 * names. A runner keeps what a run stores beside its record (offloaded tool
 * output, file-review content and its blobs) under
 * `artifacts/<run id>/…`, so the run is read off the key and the lane
 * authorizes that run; no other prefix is admitted, since a file that enters
 * a session does so as a File, whose links the server mints itself.
 *
 * The rules run in a fixed order and each refusal names the rule that fired.
 * The names are the lane's own log vocabulary and never leave the server: a
 * refused request is answered with an empty 400, and the runner branches on
 * the status alone.
 *
 * Proven by __tests__/lane.test.ts (each rule's refusal, in order).
 */

/** The one prefix a runner's keys sit under, followed by the run's id. */
export const ARTIFACT_KEY_PREFIX = "artifacts/";

/** The longest key the lane admits. */
export const ARTIFACT_KEY_MAX_LENGTH = 1024;

/** The characters a key may hold: no spaces, no escapes, nothing a store reads specially. */
export const ARTIFACT_KEY_PATTERN = /^[a-zA-Z0-9/_\-.]+$/;

/** An RFC 2045 `type/subtype` pair of tokens. */
const MIME_TYPE_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;

/** The content type an upload that declares none is signed for. */
export const ARTIFACT_DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** The rule that refused a key, or undefined when every rule passed. */
export function artifactKeyProblem(key: string | undefined): string | undefined {
  if (key === undefined || key.trim() === "") {
    return "key is required";
  }
  if (key.length > ARTIFACT_KEY_MAX_LENGTH) {
    return "key exceeds maximum length";
  }
  if (!ARTIFACT_KEY_PATTERN.test(key)) {
    return "key contains invalid characters";
  }
  if (key.includes("..") || key.includes("//")) {
    return "key contains path traversal";
  }
  if (!key.startsWith(ARTIFACT_KEY_PREFIX)) {
    return `key must start with ${ARTIFACT_KEY_PREFIX}`;
  }
  return undefined;
}

/** Whether a declared content type is a `type/subtype` token pair. */
export function isValidMimeType(contentType: string): boolean {
  return MIME_TYPE_PATTERN.test(contentType);
}

/**
 * The run a key names: `artifacts/<run id>/<rest>` gives the run id;
 * undefined unless both the id and a following segment are present.
 */
export function runIdFromArtifactKey(key: string): string | undefined {
  if (!key.startsWith(ARTIFACT_KEY_PREFIX)) {
    return undefined;
  }
  const rest = key.slice(ARTIFACT_KEY_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash > 0 && slash < rest.length - 1 ? rest.slice(0, slash) : undefined;
}
