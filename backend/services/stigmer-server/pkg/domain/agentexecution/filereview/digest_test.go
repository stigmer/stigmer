package filereview

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestFileDigestVectors locks the canonical file_digest / aggregate_digest
// functions against apis/testdata/hitl/file-digest/vectors.json — expected values
// computed independently (plain sha256), so a passing run here AND in the Java
// mirror proves cross-edition parity, not self-consistency.
func TestFileDigestVectors(t *testing.T) {
	corpus := loadDigestCorpus(t)

	if len(corpus.Cases) < 4 {
		t.Fatalf("loaded %d digest cases, want >= 4 (corpus missing or not discovered)", len(corpus.Cases))
	}

	byName := make(map[string]*agentexecutionv1.CapturedFileChange, len(corpus.Cases))
	for _, c := range corpus.Cases {
		kindVal, ok := agentexecutionv1.FileChangeKind_value[c.Kind]
		if !ok {
			t.Fatalf("case %q: unknown FileChangeKind %q", c.Name, c.Kind)
		}
		change := &agentexecutionv1.CapturedFileChange{
			PathBefore:   c.PathBefore,
			PathAfter:    c.PathAfter,
			Kind:         agentexecutionv1.FileChangeKind(kindVal),
			BeforeSha256: c.BeforeSha256,
			AfterSha256:  c.AfterSha256,
		}
		byName[c.Name] = change
		if got := FileDigest(change); got != c.FileDigest {
			t.Errorf("FileDigest(%s) = %s, want %s", c.Name, got, c.FileDigest)
		}
	}

	for _, agg := range corpus.Aggregates {
		changes := make([]*agentexecutionv1.CapturedFileChange, 0, len(agg.ChangeNames))
		for _, n := range agg.ChangeNames {
			change, ok := byName[n]
			if !ok {
				t.Fatalf("aggregate %q references unknown case %q", agg.Name, n)
			}
			changes = append(changes, change)
		}
		if got := AggregateDigest(changes); got != agg.AggregateDigest {
			t.Errorf("AggregateDigest(%s) = %s, want %s", agg.Name, got, agg.AggregateDigest)
		}
	}
}

type digestCorpus struct {
	Cases []struct {
		Name         string `json:"name"`
		PathBefore   string `json:"path_before"`
		PathAfter    string `json:"path_after"`
		Kind         string `json:"kind"`
		BeforeSha256 string `json:"before_sha256"`
		AfterSha256  string `json:"after_sha256"`
		FileDigest   string `json:"file_digest"`
	} `json:"cases"`
	Aggregates []struct {
		Name            string   `json:"name"`
		ChangeNames     []string `json:"change_names"`
		AggregateDigest string   `json:"aggregate_digest"`
	} `json:"aggregates"`
}

func loadDigestCorpus(t *testing.T) digestCorpus {
	t.Helper()
	path := filepath.Join(repoTestdataHitl(t), "file-digest", "vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading digest vectors %s: %v", path, err)
	}
	var corpus digestCorpus
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatalf("decoding digest vectors %s: %v", path, err)
	}
	return corpus
}
