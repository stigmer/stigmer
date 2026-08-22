package approval

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// policySourceVector mirrors one entry of apis/testdata/hitl/policy-source/vectors.json.
// policySource is the runner's union string (or null for UNSPECIFIED) and is not
// used here; the OSS edition consumes the generated enum directly, so it asserts
// the proto name resolves to the pinned number.
type policySourceVector struct {
	Name      string `json:"name"`
	NameProto string `json:"name_proto"`
	Number    int32  `json:"number"`
}

// TestPolicySourceCorpus is the OSS half of the cross-edition authorization-
// provenance parity gate: every vector's proto enum name must resolve, through
// the generated ApprovalPolicySource_value map, to the pinned number. The runner
// (TS) asserts its toProtoPolicySource lands on the same number and the Cloud
// (Java) edition asserts the same name->number, so a renumbering in any edition
// or a drift in the runner mapping fails one of the three suites.
func TestPolicySourceCorpus(t *testing.T) {
	corpus := loadPolicySourceCorpus(t)

	// Guard the guard: the corpus must cover every enum value, so a silently
	// truncated file cannot pass for the wrong reason.
	wantCount := len(agentexecutionv1.ApprovalPolicySource_name)
	if len(corpus) != wantCount {
		t.Fatalf("loaded %d policy-source vectors, want %d (one per enum value)", len(corpus), wantCount)
	}

	for _, v := range corpus {
		t.Run(v.Name, func(t *testing.T) {
			got, ok := agentexecutionv1.ApprovalPolicySource_value[v.NameProto]
			if !ok {
				t.Fatalf("enum name %q not found in ApprovalPolicySource_value", v.NameProto)
			}
			if got != v.Number {
				t.Errorf("ApprovalPolicySource_value[%q] = %d, want %d", v.NameProto, got, v.Number)
			}
			// The reverse map must agree, locking the name<->number pairing.
			if name := agentexecutionv1.ApprovalPolicySource_name[v.Number]; name != v.NameProto {
				t.Errorf("ApprovalPolicySource_name[%d] = %q, want %q", v.Number, name, v.NameProto)
			}
		})
	}
}

func loadPolicySourceCorpus(t *testing.T) []policySourceVector {
	t.Helper()
	path := filepath.Join(hitlCorpusDir(t), "policy-source", "vectors.json")

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading policy-source corpus %s: %v", path, err)
	}
	var doc struct {
		Vectors []policySourceVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decoding policy-source corpus %s: %v", path, err)
	}
	return doc.Vectors
}
