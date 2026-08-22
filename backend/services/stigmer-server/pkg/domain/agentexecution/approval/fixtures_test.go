package approval

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// fixture mirrors the shared HITL scenario schema (apis/testdata/hitl/schema.json).
// Proto bodies are kept as raw protojson and decoded with the generated types so a
// malformed scenario fails loudly rather than being silently skipped.
type fixture struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Input       struct {
		Messages           []json.RawMessage `json:"messages"`
		SubAgentExecutions []json.RawMessage `json:"sub_agent_executions"`
	} `json:"input"`
	Expected struct {
		PendingApprovals []json.RawMessage `json:"pending_approvals"`
	} `json:"expected"`
}

// TestSharedFixtureCorpus is the OSS half of the cross-edition parity gate: every
// scenario in apis/testdata/hitl/scenarios is projected BOTH ways (message scan
// and shadow event stream) and both must equal the expected pending_approvals.
// The Java mirror loads the same files, so a behavioral drift between editions
// fails one of the two suites.
func TestSharedFixtureCorpus(t *testing.T) {
	dir := scenariosDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading scenarios dir %s: %v", dir, err)
	}

	loaded := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		loaded++
		name := entry.Name()
		t.Run(name, func(t *testing.T) {
			fx := loadFixture(t, filepath.Join(dir, name))

			messages := decodeMessages(t, fx.Input.Messages)
			subAgents := decodeSubAgents(t, fx.Input.SubAgentExecutions)
			want := decodePendingApprovals(t, fx.Expected.PendingApprovals)

			// Path 1: the authoritative message scan.
			fromScan := ComputePendingApprovals(messages, subAgents)
			if diff := diffPendingApprovals(want, fromScan); diff != "" {
				t.Errorf("message-scan projection != expected: %s", diff)
			}

			// Path 2: the shadow event-stream projection must agree with the same
			// expectation (this is the parity the corpus exists to enforce).
			fromEvents := ComputePendingApprovalsFromEvents(EmitApprovalEvents(messages, subAgents))
			if diff := diffPendingApprovals(want, fromEvents); diff != "" {
				t.Errorf("event-stream projection != expected: %s", diff)
			}
		})
	}

	// Guard the guard: a silently empty corpus would make this test pass for the
	// wrong reason. The plan mandates >= 10 scenarios.
	if loaded < 10 {
		t.Fatalf("loaded %d scenarios, want >= 10 (corpus missing or not discovered)", loaded)
	}
}

func scenariosDir(t *testing.T) string {
	t.Helper()
	return filepath.Join(hitlCorpusDir(t), "scenarios")
}

func loadFixture(t *testing.T, path string) fixture {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading fixture %s: %v", path, err)
	}
	var fx fixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("decoding fixture envelope %s: %v", path, err)
	}
	return fx
}

func decodeMessages(t *testing.T, raws []json.RawMessage) []*agentexecutionv1.AgentMessage {
	t.Helper()
	out := make([]*agentexecutionv1.AgentMessage, 0, len(raws))
	for i, raw := range raws {
		msg := &agentexecutionv1.AgentMessage{}
		if err := protojson.Unmarshal(raw, msg); err != nil {
			t.Fatalf("decoding messages[%d]: %v", i, err)
		}
		out = append(out, msg)
	}
	return out
}

func decodeSubAgents(t *testing.T, raws []json.RawMessage) []*agentexecutionv1.SubAgentExecution {
	t.Helper()
	out := make([]*agentexecutionv1.SubAgentExecution, 0, len(raws))
	for i, raw := range raws {
		sa := &agentexecutionv1.SubAgentExecution{}
		if err := protojson.Unmarshal(raw, sa); err != nil {
			t.Fatalf("decoding sub_agent_executions[%d]: %v", i, err)
		}
		out = append(out, sa)
	}
	return out
}

func decodePendingApprovals(t *testing.T, raws []json.RawMessage) []*agentexecutionv1.PendingApproval {
	t.Helper()
	out := make([]*agentexecutionv1.PendingApproval, 0, len(raws))
	for i, raw := range raws {
		pa := &agentexecutionv1.PendingApproval{}
		if err := protojson.Unmarshal(raw, pa); err != nil {
			t.Fatalf("decoding expected.pending_approvals[%d]: %v", i, err)
		}
		out = append(out, pa)
	}
	// Deterministic order is irrelevant to diffPendingApprovals (it keys by
	// tool_call_id), but sorting keeps any future ordered assertions stable.
	sort.Slice(out, func(a, b int) bool { return out[a].GetToolCallId() < out[b].GetToolCallId() })
	return out
}
