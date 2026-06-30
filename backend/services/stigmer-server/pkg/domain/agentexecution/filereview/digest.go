// Package filereview is the backend half of the apply-then-review file-change
// subsystem (domain: agentic / agentexecution). It owns the canonical change
// digests, authors FILE_DECIDED events on the append-only file_review ledger,
// and projects FileChangeSet from that ledger. It is the file-review sibling of
// the approval package — the same append-only-ledger discipline instantiated for
// a second lifecycle.
package filereview

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// FileDigest is the canonical identity+content digest of one captured file
// change — the enforcement key the runner's reconcile checks before applying a
// decision ("what you approve is what gets applied"). It is NEVER a correlation
// key; correlation is by CapturedFileChange.id.
//
// The canonical form digests the content HASHES (before_sha256 / after_sha256),
// not the raw bytes, so the string is pure ASCII and has no line-ending or
// encoding ambiguity to reconcile across Go and Java. kind uses the proto enum
// value name (identical to Java's name()). The format is locked by
// apis/testdata/hitl/file-digest/vectors.json.
func FileDigest(c *agentexecutionv1.CapturedFileChange) string {
	canonical := strings.Join([]string{
		c.GetPathBefore(),
		c.GetPathAfter(),
		c.GetKind().String(),
		c.GetBeforeSha256(),
		c.GetAfterSha256(),
	}, "\n")
	return sha256Hex(canonical)
}

// AggregateDigest is the canonical digest over a change set's whole manifest.
// The per-file digests are sorted so the result is independent of input order (a
// change set is an unordered set of files for identity). The empty set hashes
// the empty string. Enforcement only, never a correlation key.
func AggregateDigest(changes []*agentexecutionv1.CapturedFileChange) string {
	digests := make([]string, 0, len(changes))
	for _, c := range changes {
		digests = append(digests, FileDigest(c))
	}
	sort.Strings(digests)
	return sha256Hex(strings.Join(digests, "\n"))
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
