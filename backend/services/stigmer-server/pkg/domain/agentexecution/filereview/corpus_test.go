package filereview

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// This is the OSS half of the cross-edition file-review projection corpus
// (apis/testdata/hitl/file-review). It replays a persisted file_review ledger
// through ProjectFileChangeSets and asserts the projected summary. The Java
// mirror replays the same files, so a fold/status/derivation drift between the
// editions fails one of the two suites. See the corpus README for the format.

type fileReviewFixture struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	ExecutionID string                 `json:"execution_id"`
	Phase       string                 `json:"phase"`
	Events      []json.RawMessage      `json:"events"`
	Expected    []fileChangeSetSummary `json:"expected"`
}

// fileChangeSetSummary is the normalized projection of a FileChangeSet the corpus
// asserts cross-edition: the derived status, the ordered change ids, the derived
// decision count, the carried aggregate digest, and whether an approved snapshot
// was set. Internal event_id/timestamp shapes are locked by per-edition unit tests.
type fileChangeSetSummary struct {
	ID                    string   `json:"id"`
	Status                string   `json:"status"`
	DiffCompleteness      string   `json:"diff_completeness"`
	ChangeIDs             []string `json:"change_ids"`
	BlockedReasons        []string `json:"blocked_reasons"`
	AcknowledgedChangeIDs []string `json:"acknowledged_change_ids"`
	DecisionCount         int      `json:"decision_count"`
	AggregateDigest       string   `json:"aggregate_digest"`
	HasApprovedSnapshot   bool     `json:"has_approved_snapshot"`
}

func TestFileReviewProjectionCorpus(t *testing.T) {
	dir := filepath.Join(repoTestdataHitl(t), "file-review")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading file-review dir %s: %v", dir, err)
	}

	loaded := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" || entry.Name() == "schema.json" {
			continue
		}
		loaded++
		name := entry.Name()
		t.Run(name, func(t *testing.T) {
			runFileReviewFixture(t, loadFileReviewFixture(t, filepath.Join(dir, name)))
		})
	}

	// Guard the guard: a silently empty corpus would pass for the wrong reason.
	if loaded < 5 {
		t.Fatalf("loaded %d file-review fixtures, want >= 5 (corpus missing or not discovered)", loaded)
	}
}

func runFileReviewFixture(t *testing.T, fx fileReviewFixture) {
	t.Helper()

	stream := &agentexecutionv1.FileReviewEventStream{ExecutionId: fx.ExecutionID}
	for i, raw := range fx.Events {
		ev := &agentexecutionv1.FileReviewEvent{}
		if err := protojson.Unmarshal(raw, ev); err != nil {
			t.Fatalf("decoding events[%d]: %v", i, err)
		}
		stream.Events = append(stream.Events, ev)
	}

	phase := parseExecutionPhase(t, fx.Phase)
	got := ProjectFileChangeSets(phase, stream)

	if len(got) != len(fx.Expected) {
		t.Fatalf("projected %d change sets, want %d", len(got), len(fx.Expected))
	}
	for i, want := range fx.Expected {
		summary := summarize(got[i])
		assertSummary(t, i, summary, want)
	}
}

func summarize(cs *agentexecutionv1.FileChangeSet) fileChangeSetSummary {
	changeIDs := make([]string, 0, len(cs.GetChanges()))
	blockedReasons := make([]string, 0, len(cs.GetChanges()))
	for _, c := range cs.GetChanges() {
		changeIDs = append(changeIDs, c.GetId())
		blockedReasons = append(blockedReasons, c.GetBlockedReason().String())
	}
	acknowledged := make([]string, 0)
	for _, d := range cs.GetDecisions() {
		if d.GetAcknowledgeUnreviewable() {
			acknowledged = append(acknowledged, d.GetFileChangeId())
		}
	}
	return fileChangeSetSummary{
		ID:                    cs.GetId(),
		Status:                cs.GetStatus().String(),
		DiffCompleteness:      cs.GetDiffCompleteness().String(),
		ChangeIDs:             changeIDs,
		BlockedReasons:        blockedReasons,
		AcknowledgedChangeIDs: acknowledged,
		DecisionCount:         len(cs.GetDecisions()),
		AggregateDigest:       cs.GetAggregateDigest(),
		HasApprovedSnapshot:   cs.GetApprovedSnapshot() != nil,
	}
}

func assertSummary(t *testing.T, idx int, got, want fileChangeSetSummary) {
	t.Helper()
	if got.ID != want.ID {
		t.Errorf("change set[%d] id = %q, want %q", idx, got.ID, want.ID)
	}
	if got.Status != want.Status {
		t.Errorf("change set[%d] (%s) status = %q, want %q", idx, want.ID, got.Status, want.Status)
	}
	// diff_completeness is optional: asserted only when the fixture declares it,
	// so it never forces every vector to enumerate the (usually COMPLETE) rollup.
	if want.DiffCompleteness != "" && got.DiffCompleteness != want.DiffCompleteness {
		t.Errorf("change set[%d] (%s) diff_completeness = %q, want %q", idx, want.ID, got.DiffCompleteness, want.DiffCompleteness)
	}
	if got.DecisionCount != want.DecisionCount {
		t.Errorf("change set[%d] (%s) decision_count = %d, want %d", idx, want.ID, got.DecisionCount, want.DecisionCount)
	}
	if got.AggregateDigest != want.AggregateDigest {
		t.Errorf("change set[%d] (%s) aggregate_digest = %q, want %q", idx, want.ID, got.AggregateDigest, want.AggregateDigest)
	}
	if got.HasApprovedSnapshot != want.HasApprovedSnapshot {
		t.Errorf("change set[%d] (%s) has_approved_snapshot = %v, want %v", idx, want.ID, got.HasApprovedSnapshot, want.HasApprovedSnapshot)
	}
	if len(got.ChangeIDs) != len(want.ChangeIDs) {
		t.Fatalf("change set[%d] (%s) change_ids = %v, want %v", idx, want.ID, got.ChangeIDs, want.ChangeIDs)
	}
	for i := range want.ChangeIDs {
		if got.ChangeIDs[i] != want.ChangeIDs[i] {
			t.Errorf("change set[%d] (%s) change_ids[%d] = %q, want %q", idx, want.ID, i, got.ChangeIDs[i], want.ChangeIDs[i])
		}
	}
	// blocked_reasons is optional: asserted only when the fixture declares it, so
	// it never forces every vector to enumerate the (usually UNSPECIFIED) reasons.
	if len(want.BlockedReasons) > 0 {
		if len(got.BlockedReasons) != len(want.BlockedReasons) {
			t.Fatalf("change set[%d] (%s) blocked_reasons = %v, want %v", idx, want.ID, got.BlockedReasons, want.BlockedReasons)
		}
		for i := range want.BlockedReasons {
			if got.BlockedReasons[i] != want.BlockedReasons[i] {
				t.Errorf("change set[%d] (%s) blocked_reasons[%d] = %q, want %q", idx, want.ID, i, got.BlockedReasons[i], want.BlockedReasons[i])
			}
		}
	}
	// acknowledged_change_ids is optional (DD-16): asserted only when declared, so
	// only the acknowledged-binary vector enumerates it.
	if len(want.AcknowledgedChangeIDs) > 0 {
		if len(got.AcknowledgedChangeIDs) != len(want.AcknowledgedChangeIDs) {
			t.Fatalf("change set[%d] (%s) acknowledged_change_ids = %v, want %v", idx, want.ID, got.AcknowledgedChangeIDs, want.AcknowledgedChangeIDs)
		}
		for i := range want.AcknowledgedChangeIDs {
			if got.AcknowledgedChangeIDs[i] != want.AcknowledgedChangeIDs[i] {
				t.Errorf("change set[%d] (%s) acknowledged_change_ids[%d] = %q, want %q", idx, want.ID, i, got.AcknowledgedChangeIDs[i], want.AcknowledgedChangeIDs[i])
			}
		}
	}
}

func loadFileReviewFixture(t *testing.T, path string) fileReviewFixture {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading fixture %s: %v", path, err)
	}
	var fx fileReviewFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("decoding fixture %s: %v", path, err)
	}
	return fx
}

func parseExecutionPhase(t *testing.T, s string) agentexecutionv1.ExecutionPhase {
	t.Helper()
	v, ok := agentexecutionv1.ExecutionPhase_value[s]
	if !ok {
		t.Fatalf("unknown ExecutionPhase %q", s)
	}
	return agentexecutionv1.ExecutionPhase(v)
}

// repoTestdataHitl resolves apis/testdata/hitl from this test file's location.
// filereview/ sits seven directories below the repo root, the same depth as the
// approval package's corpus loader.
func repoTestdataHitl(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed; cannot locate the corpus")
	}
	repoRoot := filepath.Join(filepath.Dir(thisFile), "../../../../../../..")
	return filepath.Join(repoRoot, "apis", "testdata", "hitl")
}
