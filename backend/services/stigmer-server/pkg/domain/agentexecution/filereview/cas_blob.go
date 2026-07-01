package filereview

import "regexp"

// casBlobKeyPattern matches a CAS blob storage key and captures its content
// address. The runner content-addresses gitignored/non-git before/after bytes
// (shared/filereview/cas-substrate.ts) under the execution-scoped artifact
// prefix: artifacts/{execution_id}/filereview/cas/blobs/{sha256}. The trailing
// 64-char lowercase-hex segment IS the SHA-256 of the stored bytes, which makes
// the key self-verifying. Hex is strict lowercase to match the producer, so an
// off-convention key is treated as non-CAS (skipped) rather than as a failure.
var casBlobKeyPattern = regexp.MustCompile(`^artifacts/[^/]+/filereview/cas/blobs/([0-9a-f]{64})$`)

// casBlobContentMismatchReason is the single, static, user-facing reason returned
// when a CAS blob's served bytes do not match the content address in its key. It
// is intentionally free of interpolated hashes or keys: the message is safe to
// surface, the diagnostics go to the caller's structured log, and a static string
// lets the Go and Java mirror tables assert exact equality.
const casBlobContentMismatchReason = "artifact content failed integrity verification: the stored bytes do not match the content address in the storage key"

// casBlobKeyHash returns the content address (lowercase-hex SHA-256) embedded in a
// CAS blob storage key, and whether the key is a CAS blob key at all.
func casBlobKeyHash(storageKey string) (string, bool) {
	m := casBlobKeyPattern.FindStringSubmatch(storageKey)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// CasBlobContentMismatch reports why served bytes fail the content-address
// integrity check embedded in a CAS blob storage key, or "" when the read may be
// served. It is the content-integrity sibling of ApproveBlockedReason: a pure,
// grpc-free predicate whose non-empty reason the caller maps to a DATA_LOSS
// status.
//
// Fail-open on anything that is not a CAS blob key: git-substrate offloads,
// tool-call outputs, attachments, the CAS manifest, or any future/renamed
// convention all return "" and are served untouched. This guarantees non-CAS
// artifacts are never gated and serving never breaks if the key convention
// evolves; the recognized shape is pinned by the mirror tables.
//
// The caller MUST pass the COMPLETE object bytes. A truncated read cannot be
// full-hash-verified, so the caller skips verification (and never calls this) when
// it holds only part of the object. Enforcement only, never a correlation key.
func CasBlobContentMismatch(storageKey string, content []byte) string {
	want, ok := casBlobKeyHash(storageKey)
	if !ok {
		return ""
	}
	if sha256HexBytes(content) == want {
		return ""
	}
	return casBlobContentMismatchReason
}
