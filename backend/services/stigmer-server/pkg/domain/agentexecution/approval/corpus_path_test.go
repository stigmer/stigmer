package approval

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// hitlCorpusDir locates the shared HITL corpus (apis/testdata/hitl) — the single
// source of truth the TS, Go, and Java editions all reproduce — from either
// execution environment. Under `bazel test` the corpus arrives in the test's
// runfiles via the go_test data dep (oss#722) and TEST_SRCDIR/TEST_WORKSPACE
// point at it; under plain `go test` (make check-go) those are unset and the
// corpus is reached through the compiled-in source path of this file.
func hitlCorpusDir(t *testing.T) string {
	t.Helper()
	if srcdir := os.Getenv("TEST_SRCDIR"); srcdir != "" {
		return filepath.Join(srcdir, os.Getenv("TEST_WORKSPACE"), "apis", "testdata", "hitl")
	}
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed; cannot locate the shared fixture corpus")
	}
	// thisFile: backend/services/stigmer-server/pkg/domain/agentexecution/approval/corpus_path_test.go
	// repo root is seven directories up; the corpus lives under apis/testdata/hitl.
	repoRoot := filepath.Join(filepath.Dir(thisFile), "../../../../../../..")
	return filepath.Join(repoRoot, "apis", "testdata", "hitl")
}
