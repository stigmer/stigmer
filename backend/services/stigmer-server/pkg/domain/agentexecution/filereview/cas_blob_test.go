package filereview

import (
	"strings"
	"testing"
)

// casBlobKey builds a well-formed CAS blob key whose content address is the
// SHA-256 of content — the exact shape the runner writes.
func casBlobKey(executionID string, content []byte) string {
	return "artifacts/" + executionID + "/filereview/cas/blobs/" + sha256HexBytes(content)
}

// TestCasBlobContentMismatch proves the serve-time content-address check:
// matching bytes (including a zero-byte blob) pass, tampered bytes yield the
// pinned reason, and every non-CAS key shape fails open (""). Mirrored by the
// Java CasBlobKeyTest — the reason string is byte-identical across editions.
func TestCasBlobContentMismatch(t *testing.T) {
	hello := []byte("hello world")
	helloKey := casBlobKey("aex_1", hello)
	empty := []byte{}
	emptyKey := casBlobKey("aex_1", empty)

	// A syntactically valid CAS key (64 lowercase hex) whose address is the hash
	// of "hello", served with different bytes — the tamper/corruption case.
	tamperedKey := casBlobKey("aex_1", []byte("hello"))

	cases := []struct {
		name       string
		storageKey string
		content    []byte
		wantReason string
	}{
		{"matching blob passes", helloKey, hello, ""},
		{"zero-byte blob passes", emptyKey, empty, ""},
		{"tampered blob is flagged", tamperedKey, []byte("goodbye"), casBlobContentMismatchReason},
		{"manifest key is not a blob key", "artifacts/aex_1/filereview/cas/aex_1_0.manifest.json", hello, ""},
		{"git-substrate offload key is not a blob key", "artifacts/aex_1/filereview/aex_1:0:foo.txt.before.txt", hello, ""},
		{"toolcalls key is not a blob key", "artifacts/aex_1/toolcalls/tc1.txt", hello, ""},
		{"short hex (63) is not a blob key", "artifacts/aex_1/filereview/cas/blobs/" + strings.Repeat("a", 63), hello, ""},
		{"long hex (65) is not a blob key", "artifacts/aex_1/filereview/cas/blobs/" + strings.Repeat("a", 65), hello, ""},
		{"uppercase hex is not a blob key", "artifacts/aex_1/filereview/cas/blobs/" + strings.Repeat("A", 64), hello, ""},
		{"traversal after blobs is not a blob key", "artifacts/aex_1/filereview/cas/blobs/../../../etc/passwd", hello, ""},
		{"extra segment after hash is not a blob key", casBlobKey("aex_1", hello) + "/x", hello, ""},
		{"empty key is not a blob key", "", hello, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CasBlobContentMismatch(tc.storageKey, tc.content); got != tc.wantReason {
				t.Fatalf("CasBlobContentMismatch(%q) = %q, want %q", tc.storageKey, got, tc.wantReason)
			}
		})
	}
}

// TestCasBlobKeyHash asserts the predicate half in isolation: it recognizes a
// well-formed key and extracts its address, and rejects near-miss shapes.
func TestCasBlobKeyHash(t *testing.T) {
	hash := sha256HexBytes([]byte("x"))
	key := "artifacts/aex_9/filereview/cas/blobs/" + hash

	got, ok := casBlobKeyHash(key)
	if !ok || got != hash {
		t.Fatalf("casBlobKeyHash(%q) = (%q, %v), want (%q, true)", key, got, ok, hash)
	}

	for _, bad := range []string{
		"",
		"artifacts/aex_9/filereview/cas/aex_9_0.manifest.json",
		"artifacts/aex_9/filereview/cas/blobs/" + strings.Repeat("z", 64), // non-hex
		"artifacts/aex_9/filereview/cas/blobs/" + strings.ToUpper(hash),
	} {
		if _, ok := casBlobKeyHash(bad); ok {
			t.Fatalf("casBlobKeyHash(%q) = ok, want not-a-CAS-key", bad)
		}
	}
}
