package approval

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// leaseScopeVector mirrors one entry of apis/testdata/hitl/lease-scope/vectors.json.
// expected is null (no leasable scope), {"category": ...}, or {"server": ...}.
type leaseScopeVector struct {
	Name  string `json:"name"`
	Input struct {
		ToolName      string `json:"toolName"`
		McpServerSlug string `json:"mcpServerSlug"`
	} `json:"input"`
	Expected *struct {
		Category string `json:"category"`
		Server   string `json:"server"`
	} `json:"expected"`
}

// TestLeaseScopeCorpus is the OSS half of the cross-edition lease-scope parity
// gate: every vector in apis/testdata/hitl/lease-scope is derived by
// DeriveLeaseScope and must equal the expected scope. The runner (TS) and Cloud
// (Java) editions load the same file, so a drift fails one of the three suites.
func TestLeaseScopeCorpus(t *testing.T) {
	corpus := loadLeaseScopeCorpus(t)

	// Guard the guard: a silently empty corpus would pass for the wrong reason.
	if len(corpus) < 10 {
		t.Fatalf("loaded %d lease-scope vectors, want >= 10 (corpus missing or not discovered)", len(corpus))
	}

	for _, v := range corpus {
		t.Run(v.Name, func(t *testing.T) {
			tc := &agentexecutionv1.ToolCall{
				Name:          v.Input.ToolName,
				McpServerSlug: v.Input.McpServerSlug,
			}
			scope, ok := DeriveLeaseScope(tc)

			if v.Expected == nil {
				if ok {
					t.Fatalf("expected no leasable scope, got %+v", scope)
				}
				return
			}
			if !ok {
				t.Fatalf("expected scope %+v, got none", *v.Expected)
			}
			want := LeaseScope{Category: v.Expected.Category, Server: v.Expected.Server}
			if scope != want {
				t.Errorf("scope = %+v, want %+v", scope, want)
			}
		})
	}
}

func loadLeaseScopeCorpus(t *testing.T) []leaseScopeVector {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed; cannot locate the lease-scope corpus")
	}
	// thisFile: backend/services/stigmer-server/pkg/domain/agentexecution/approval/lease_scope_corpus_test.go
	// repo root is seven directories up; the corpus lives under apis/testdata/hitl.
	repoRoot := filepath.Join(filepath.Dir(thisFile), "../../../../../../..")
	path := filepath.Join(repoRoot, "apis", "testdata", "hitl", "lease-scope", "vectors.json")

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading lease-scope corpus %s: %v", path, err)
	}
	var doc struct {
		Vectors []leaseScopeVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decoding lease-scope corpus %s: %v", path, err)
	}
	return doc.Vectors
}
