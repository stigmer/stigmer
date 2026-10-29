/**
 * The canonical file-change digests. The
 * filereview module is the backend half of the apply-then-review
 * file-change subsystem: it owns the canonical change digests, reads the
 * run's file record (record.ts) and records decisions as the session's
 * `stigmer.file_review.decided` events (decided.ts).
 *
 * FileDigest is the enforcement key the runner's reconcile checks before
 * applying a decision ("what you approve is what gets applied"); NEVER a
 * correlation key (correlation is by CapturedFileChange.id). The
 * canonical form digests the content HASHES, not raw bytes, so the string
 * is pure ASCII with no encoding ambiguity across editions. kind renders
 * as the proto enum value name. The format
 * is locked by apis/testdata/hitl/file-digest/vectors.json.
 */
import { createHash } from "node:crypto";

import { enumToJson } from "@bufbuild/protobuf";

import { FileChangeKindSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

export function fileDigest(c: CapturedFileChange): string {
  const canonical = [
    c.pathBefore,
    c.pathAfter,
    enumToJson(FileChangeKindSchema, c.kind) as string,
    c.beforeSha256,
    c.afterSha256,
  ].join("\n");
  return sha256Hex(canonical);
}

/**
 * The canonical digest over a change set's whole manifest. Per-file
 * digests are sorted so the result is independent of input order (a
 * change set is an unordered set of files for identity). The empty set
 * hashes the empty string. Enforcement only, never a correlation key.
 */
export function aggregateDigest(changes: CapturedFileChange[]): string {
  const digests = changes.map(fileDigest);
  digests.sort();
  return sha256Hex(digests.join("\n"));
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

/**
 * The raw-bytes content address CAS blobs are keyed by (Node
 * createHash("sha256").digest("hex") — lowercase hex, the producer's
 * spelling).
 */
export function sha256HexBytes(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}
