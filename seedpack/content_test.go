package seedpack

import (
	"bytes"
	"io"
	"io/fs"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

// TestContent_AllYAMLHaveKind guards the declarative-apply contract at the
// content source: every YAML file in the embedded seedpack is a Stigmer resource
// and must carry a top-level `kind`. The bootstrap feeds the whole content tree
// through the CLI's loadDocuments(strict), which rejects any kind-less file — so
// a non-resource YAML (e.g. the CI canary manifest) must never live among the
// embedded content. Such files belong outside the embedded set (seedpack/canary/
// or seedpack/tools/), which all four delivery paths exclude by omission.
//
// This is the upstream guard for that whole bug class: it runs on every
// seedpack/** PR (ci.seedpack-static.yaml) and fails before a kind-less file can
// break the bootstrap on any delivery path.
func TestContent_AllYAMLHaveKind(t *testing.T) {
	walkErr := fs.WalkDir(content, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(path) != ".yaml" {
			return nil
		}

		data, err := content.ReadFile(path)
		if err != nil {
			return err
		}

		// A seedpack file may hold multiple YAML documents; check each one and
		// skip empty documents (e.g. a trailing `---`).
		dec := yaml.NewDecoder(bytes.NewReader(data))
		for docIndex := 0; ; docIndex++ {
			var doc map[string]any
			decErr := dec.Decode(&doc)
			if decErr == io.EOF {
				break
			}
			if decErr != nil {
				t.Errorf("%s (doc %d): YAML parse error: %v", path, docIndex, decErr)
				break
			}
			if doc == nil {
				continue // empty document
			}
			if kind, _ := doc["kind"].(string); kind == "" {
				t.Errorf("%s (doc %d): missing top-level 'kind' — non-resource files must live "+
					"outside the embedded content set (e.g. seedpack/canary/ or seedpack/tools/)", path, docIndex)
			}
		}
		return nil
	})
	if walkErr != nil {
		t.Fatalf("failed to walk embedded content: %v", walkErr)
	}
}
