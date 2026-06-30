/**
 * Canonical file-review digests — the runner-side mirror of the Go
 * {@code filereview/digest.go} and the Java {@code FileDigest}, locked
 * byte-for-byte by `apis/testdata/hitl/file-digest/vectors.json`.
 *
 * These are ENFORCEMENT digests, never correlation keys: the reconcile refuses
 * to apply content whose digest differs from what the user approved. The runner
 * is the sole producer of `before_sha256`/`after_sha256` (over the exact captured
 * bytes) and of the derived `file_digest`/`aggregate_digest`; the backends only
 * carry them. Keeping the formula identical across all three editions is what
 * lets the cross-edition corpus prove parity.
 */

import { createHash } from "node:crypto";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * The proto enum value NAME for a {@link FileChangeKind}, e.g.
 * `FILE_CHANGE_KIND_MODIFY`. The digest is computed over this name (matching Go's
 * `kind.String()` and Java's `kind.name()`), NOT the TS member name, so all three
 * editions hash an identical string. The cross-edition digest corpus validates
 * this map; a missing or wrong entry fails the parity test.
 */
const FILE_CHANGE_KIND_NAME: Readonly<Record<FileChangeKind, string>> = {
  [FileChangeKind.UNSPECIFIED]: "FILE_CHANGE_KIND_UNSPECIFIED",
  [FileChangeKind.ADD]: "FILE_CHANGE_KIND_ADD",
  [FileChangeKind.MODIFY]: "FILE_CHANGE_KIND_MODIFY",
  [FileChangeKind.DELETE]: "FILE_CHANGE_KIND_DELETE",
  [FileChangeKind.RENAME]: "FILE_CHANGE_KIND_RENAME",
  [FileChangeKind.BINARY_CHANGE]: "FILE_CHANGE_KIND_BINARY_CHANGE",
};

/** The proto enum value name for a FileChangeKind (for the digest canonical form). */
export function fileChangeKindName(kind: FileChangeKind): string {
  return FILE_CHANGE_KIND_NAME[kind] ?? "FILE_CHANGE_KIND_UNSPECIFIED";
}

/** Lowercase-hex SHA-256 of a UTF-8 string. */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Lowercase-hex SHA-256 of raw bytes — used for `before_sha256`/`after_sha256`. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The identity+content fields a {@link fileDigest} is computed over. */
export interface FileDigestInput {
  readonly pathBefore: string;
  readonly pathAfter: string;
  readonly kind: FileChangeKind;
  readonly beforeSha256: string;
  readonly afterSha256: string;
}

/**
 * The canonical per-file digest:
 * `sha256(join("\n", [path_before, path_after, kind_name, before_sha256, after_sha256]))`.
 * Digesting the content HASHES (not raw bytes) keeps the string pure ASCII, free
 * of any line-ending or encoding ambiguity across editions.
 */
export function fileDigest(input: FileDigestInput): string {
  return sha256Hex(
    [
      input.pathBefore,
      input.pathAfter,
      fileChangeKindName(input.kind),
      input.beforeSha256,
      input.afterSha256,
    ].join("\n"),
  );
}

/**
 * The canonical change-set digest: `sha256(join("\n", sort_ascending(file_digests)))`.
 * Sorting makes it independent of file order (a change set is an unordered set of
 * files for identity). The empty set hashes the empty string.
 */
export function aggregateDigest(inputs: readonly FileDigestInput[]): string {
  const digests = inputs.map(fileDigest).sort();
  return sha256Hex(digests.join("\n"));
}
