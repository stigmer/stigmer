package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNoInternalSectionsLeak is the repo gate for the @internal comment
// convention (oss#327): everything after a line that is exactly "@internal"
// in a proto comment is proto-source-only and must never reach a generated
// surface. proto2schema strips it at extraction — the single owner of the
// convention — so the committed schema JSONs and every artifact generated
// from them must be marker-free.
//
// The gate scans the committed schemas (the choke point every generator
// consumes) plus the committed proto-derived artifacts that carry
// description text. It exists so a regression in the extractor, a stale
// regeneration, or a hand-edited schema fails CI instead of shipping
// internal implementation notes to SDK docs and LLM-facing MCP tool
// schemas.
//
// Deliberately NOT scanned:
//   - sdk/go/gen — stale on main from long before the strip landed
//     (regenerating it sweeps in unrelated schema-evolution drift); its
//     reconciliation is tracked in oss#496 and it joins this gate when it
//     is regenerated.
//   - sdk/typescript/src/gen — its only "@internal" occurrences are
//     intentional hand-authored TSDoc visibility markers hardcoded in the
//     generator template (sdk_client_ts.go), not proto-derived text.
func TestNoInternalSectionsLeak(t *testing.T) {
	repoRoot := repoRootDir(t)

	scanRoots := []string{
		"tools/codegen/schemas",
		"tools/codegen/output",
		"mcp-server/src/gen",
		"backend/services/stigmer-server/pkg/domain/workflow/registry/data",
	}

	for _, root := range scanRoots {
		absRoot := filepath.Join(repoRoot, root)
		if _, err := os.Stat(absRoot); err != nil {
			t.Fatalf("scan root %s missing: %v (moved? update this gate)", root, err)
		}

		err := filepath.WalkDir(absRoot, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			switch filepath.Ext(path) {
			case ".json", ".ts", ".go", ".mdx":
			default:
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if idx := strings.Index(string(data), "@internal"); idx >= 0 {
				line := 1 + strings.Count(string(data[:idx]), "\n")
				rel, _ := filepath.Rel(repoRoot, path)
				t.Errorf("%s:%d carries \"@internal\" — internal proto comment "+
					"sections must be stripped at extraction (proto2schema "+
					"stripInternalSection); regenerate via `make codegen`", rel, line)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walking %s: %v", root, err)
		}
	}
}

// repoRootDir locates the repository root relative to this package
// (tools/codegen/generator → three levels up), verified by the apis/ dir.
func repoRootDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "apis")); err != nil {
		t.Fatalf("expected repo root at %s (no apis/ dir): %v", root, err)
	}
	return root
}
