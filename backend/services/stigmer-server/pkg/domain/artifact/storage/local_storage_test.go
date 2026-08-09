package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// escapingKeys are storage keys that, once cleaned, resolve outside the
// artifact root. `filepath.Join` silently cleans `..` segments rather than
// rejecting them, so without an explicit containment check these would let an
// attacker read or write outside the store. The containment guard must refuse
// every one of them.
var escapingKeys = []string{
	"../evil.txt",
	"../../evil.txt",
	"attachments/x/../../../../evil.txt",
	"attachments/../../evil.txt",
	"a/b/../../../escape",
}

// containedKeys clean to a location that is still inside the artifact root.
// The guard must allow these — it rejects escapes, not the mere presence of a
// `..` segment.
var containedKeys = []string{
	"attachments/01ABC/plan.md",
	"artifacts/exec-1/out.txt",
	"attachments/x/../y/file.txt",
	"name.with.dots.txt",
}

func TestLocalStorage_Upload_RejectsPathTraversal(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	s, err := NewLocalStorage(base, "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	for _, key := range escapingKeys {
		t.Run(key, func(t *testing.T) {
			if err := s.Upload(ctx, key, []byte("owned"), "text/plain"); err == nil {
				t.Fatalf("Upload(%q) returned nil error; expected containment rejection", key)
			}
			// Nothing must have escaped the base tree. Its parent is a fresh
			// t.TempDir() ancestor, so any stray file there is proof of escape.
			assertNoEscape(t, base, "evil.txt")
			assertNoEscape(t, base, "escape")
		})
	}
}

func TestLocalStorage_Download_RejectsPathTraversal(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	s, err := NewLocalStorage(base, "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	// Plant a file just outside the artifact root that a traversal key would
	// otherwise reach.
	parent := filepath.Dir(base)
	secret := filepath.Join(parent, "secret.txt")
	if err := os.WriteFile(secret, []byte("top secret"), 0o600); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(secret) })

	for _, key := range escapingKeys {
		t.Run(key, func(t *testing.T) {
			if _, err := s.Download(ctx, key); err == nil {
				t.Fatalf("Download(%q) returned nil error; expected containment rejection", key)
			}
		})
	}
}

func TestLocalStorage_Exists_And_Delete_RejectPathTraversal(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	s, err := NewLocalStorage(base, "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	for _, key := range escapingKeys {
		t.Run("exists/"+key, func(t *testing.T) {
			if _, err := s.Exists(ctx, key); err == nil {
				t.Fatalf("Exists(%q) returned nil error; expected containment rejection", key)
			}
		})
		t.Run("delete/"+key, func(t *testing.T) {
			if err := s.Delete(ctx, key); err == nil {
				t.Fatalf("Delete(%q) returned nil error; expected containment rejection", key)
			}
		})
	}
}

// TestLocalStorage_StoresKeyAtRootWithoutImplicitSegment pins the layout
// contract after unification (#285): the configured base path IS the artifact
// root, so a key K lands at <base>/<K> with no implicit "artifacts" segment.
// This is what lets the runner, whose LOCAL_ARTIFACT_PATH points at the same
// directory, read back exactly what the server wrote.
func TestLocalStorage_StoresKeyAtRootWithoutImplicitSegment(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	s, err := NewLocalStorage(base, "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	const key = "attachments/01ABC/plan.md"
	if err := s.Upload(ctx, key, []byte("the plan"), "text/markdown"); err != nil {
		t.Fatalf("Upload: %v", err)
	}

	// The file must be exactly at <base>/<key> ...
	wantPath := filepath.Join(base, key)
	if _, err := os.Stat(wantPath); err != nil {
		t.Fatalf("expected artifact at %s: %v", wantPath, err)
	}
	// ... and NOT under a legacy <base>/artifacts/<key> segment.
	legacyPath := filepath.Join(base, "artifacts", key)
	if _, err := os.Stat(legacyPath); err == nil {
		t.Fatalf("artifact unexpectedly stored under legacy segment at %s", legacyPath)
	}
}

func TestLocalStorage_AllowsContainedKeysWithDotSegments(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	s, err := NewLocalStorage(base, "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	for _, key := range containedKeys {
		t.Run(key, func(t *testing.T) {
			if err := s.Upload(ctx, key, []byte("ok"), "text/plain"); err != nil {
				t.Fatalf("Upload(%q) rejected a contained key: %v", key, err)
			}
			data, err := s.Download(ctx, key)
			if err != nil {
				t.Fatalf("Download(%q): %v", key, err)
			}
			if string(data) != "ok" {
				t.Fatalf("Download(%q) = %q; want %q", key, data, "ok")
			}
		})
	}
}

// assertNoEscape fails if a file with basename `name` exists anywhere in the
// parent of `base` (excluding the base subtree itself).
func assertNoEscape(t *testing.T, base, name string) {
	t.Helper()
	parent := filepath.Dir(base)
	stray := filepath.Join(parent, name)
	if _, err := os.Stat(stray); err == nil {
		t.Fatalf("file escaped the artifact root to %s", stray)
	}
}
