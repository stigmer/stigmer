package approval

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// hitlCorpusDir locates the shared HITL vector corpus, mirroring scenariosDir in
// fixtures_test.go. The corpus is the single source of truth the TS, Go, and Java
// editions all reproduce.
func hitlCorpusDir(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed; cannot locate the shared fixture corpus")
	}
	// thisFile: backend/services/stigmer-server/pkg/domain/agentexecution/approval/fingerprint_test.go
	repoRoot := filepath.Join(filepath.Dir(thisFile), "../../../../../../..")
	return filepath.Join(repoRoot, "apis", "testdata", "hitl")
}

// decodeJSONUseNumber decodes with UseNumber so integer literals in `args` arrive
// as json.Number and are reproduced without float drift — the same discipline the
// runner relies on at the source.
func decodeJSONUseNumber(t *testing.T, raw []byte, into any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("decoding vectors: %v", err)
	}
}

// TestCanonicalizationCorpus is the Go half of the canonicalization parity gate:
// every vector's canonical JSON must equal the byte-exact `expected` the TS edition
// produces.
func TestCanonicalizationCorpus(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(hitlCorpusDir(t), "canonicalization", "vectors.json"))
	if err != nil {
		t.Fatalf("reading canonicalization vectors: %v", err)
	}

	var corpus struct {
		Vectors []struct {
			Name     string          `json:"name"`
			Input    ToolActionInput `json:"input"`
			Expected string          `json:"expected"`
		} `json:"vectors"`
	}
	decodeJSONUseNumber(t, raw, &corpus)

	if len(corpus.Vectors) == 0 {
		t.Fatal("canonicalization corpus is empty (missing or not discovered)")
	}
	for _, v := range corpus.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			got, err := CanonicalToolActionJSON(v.Input)
			if err != nil {
				t.Fatalf("CanonicalToolActionJSON: %v", err)
			}
			if got != v.Expected {
				t.Errorf("canonical form mismatch\n got: %s\nwant: %s", got, v.Expected)
			}
		})
	}
}

// TestFingerprintCorpus is the Go half of the fingerprint parity gate: under the
// fixed test key, every full and coarse vector must reproduce the TS-generated
// `expected` byte for byte.
func TestFingerprintCorpus(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(hitlCorpusDir(t), "fingerprint", "vectors.json"))
	if err != nil {
		t.Fatalf("reading fingerprint vectors: %v", err)
	}

	var corpus struct {
		Key         string `json:"key"`
		KeyEncoding string `json:"keyEncoding"`
		Version     string `json:"version"`
		Full        []struct {
			Name     string          `json:"name"`
			Input    ToolActionInput `json:"input"`
			Expected string          `json:"expected"`
		} `json:"full"`
		Coarse []struct {
			Name     string          `json:"name"`
			Input    ToolActionInput `json:"input"`
			Expected string          `json:"expected"`
		} `json:"coarse"`
	}
	decodeJSONUseNumber(t, raw, &corpus)

	if corpus.KeyEncoding != "utf-8" {
		t.Fatalf("unexpected keyEncoding %q; this edition hashes the UTF-8 bytes of `key`", corpus.KeyEncoding)
	}
	if corpus.Version != ApprovalFingerprintVersion {
		t.Fatalf("corpus version %q != edition version %q", corpus.Version, ApprovalFingerprintVersion)
	}
	key := []byte(corpus.Key)

	if len(corpus.Full) == 0 || len(corpus.Coarse) == 0 {
		t.Fatal("fingerprint corpus missing full or coarse vectors")
	}

	for _, v := range corpus.Full {
		t.Run("full/"+v.Name, func(t *testing.T) {
			got, err := ComputeApprovalFingerprint(key, v.Input)
			if err != nil {
				t.Fatalf("ComputeApprovalFingerprint: %v", err)
			}
			if got != v.Expected {
				t.Errorf("full fingerprint mismatch\n got: %s\nwant: %s", got, v.Expected)
			}
		})
	}

	for _, v := range corpus.Coarse {
		t.Run("coarse/"+v.Name, func(t *testing.T) {
			got, err := ComputeCoarseApprovalFingerprint(key, v.Input)
			if err != nil {
				t.Fatalf("ComputeCoarseApprovalFingerprint: %v", err)
			}
			if got != v.Expected {
				t.Errorf("coarse fingerprint mismatch\n got: %s\nwant: %s", got, v.Expected)
			}
		})
	}
}

// TestWriteEditCollapseToOneFingerprint pins the central invariant of the coarse
// fidelity: the hook taxonomy (Write) and stream taxonomy (edit) of the same file
// mutation share one fingerprint, while a different category (shell) does not.
func TestWriteEditCollapseToOneFingerprint(t *testing.T) {
	key := []byte("unit-test-key")

	write, err := ComputeCoarseApprovalFingerprint(key, ToolActionInput{ToolName: "Write", Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	edit, err := ComputeCoarseApprovalFingerprint(key, ToolActionInput{ToolName: "edit", Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	if write != edit {
		t.Errorf("Write and edit over the same path must collapse to one fingerprint:\n  write=%s\n  edit =%s", write, edit)
	}

	shell, err := ComputeCoarseApprovalFingerprint(key, ToolActionInput{ToolName: "Shell", ShellCommand: "a.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if shell == write {
		t.Error("a shell action must not share a fingerprint with a write action")
	}
}

// TestSecretRedactionIsStableAndOpaque covers the redaction path the shared corpus
// deliberately omits (an HMAC/SHA digest is not hand-writable): a declared secret
// arg is replaced by a stable sha256: digest, never its cleartext, and the digest
// is deterministic across calls.
func TestSecretRedactionIsStableAndOpaque(t *testing.T) {
	input := ToolActionInput{
		ToolName:   "create_issue",
		Args:       map[string]any{"token": "super-secret", "repo": "acme/x"},
		SecretKeys: []string{"token"},
	}

	first, err := CanonicalToolActionJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CanonicalToolActionJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("redaction is not deterministic:\n  %s\n  %s", first, second)
	}
	if bytes.Contains([]byte(first), []byte("super-secret")) {
		t.Errorf("canonical form leaked the secret cleartext: %s", first)
	}
	if !bytes.Contains([]byte(first), []byte(`"token":"sha256:`)) {
		t.Errorf("expected token to be redacted to a sha256: digest, got: %s", first)
	}
	if !bytes.Contains([]byte(first), []byte(`"repo":"acme/x"`)) {
		t.Errorf("non-secret arg must be preserved verbatim, got: %s", first)
	}
}
