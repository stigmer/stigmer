package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func progressSet(id string, status agentexecutionv1.FileChangeSetStatus) *agentexecutionv1.FileChangeSet {
	return &agentexecutionv1.FileChangeSet{Id: id, Status: status}
}

func progress(changeSetID string) *agentexecutionv1.FileChangeProgress {
	return &agentexecutionv1.FileChangeProgress{ChangeSetId: changeSetID, FilesChanged: 3}
}

// TestReconcileFileChangeProgress locks the setup_progress-style clear: the
// transient snapshot survives only while its change set is CAPTURING, and clears
// in every other case (candidate captured, decided, terminal/empty projection,
// id mismatch on resume).
func TestReconcileFileChangeProgress(t *testing.T) {
	tests := []struct {
		name     string
		sets     []*agentexecutionv1.FileChangeSet
		progress *agentexecutionv1.FileChangeProgress
		wantKept bool
	}{
		{
			name:     "kept while its change set is CAPTURING",
			sets:     []*agentexecutionv1.FileChangeSet{progressSet("exec:0", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING)},
			progress: progress("exec:0"),
			wantKept: true,
		},
		{
			name:     "cleared once the set flips to AWAITING_REVIEW (candidate captured)",
			sets:     []*agentexecutionv1.FileChangeSet{progressSet("exec:0", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW)},
			progress: progress("exec:0"),
			wantKept: false,
		},
		{
			name:     "cleared once the set is DECIDED",
			sets:     []*agentexecutionv1.FileChangeSet{progressSet("exec:0", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_DECIDED)},
			progress: progress("exec:0"),
			wantKept: false,
		},
		{
			name:     "cleared on an empty projection (terminal execution)",
			sets:     nil,
			progress: progress("exec:0"),
			wantKept: false,
		},
		{
			name: "cleared on resume when a NEW turn's CAPTURING set has a different id",
			sets: []*agentexecutionv1.FileChangeSet{
				progressSet("exec:0", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_RECONCILED),
				progressSet("exec:1", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING),
			},
			progress: progress("exec:0"), // stale prior-turn progress
			wantKept: false,
		},
		{
			name:     "nil progress stays nil",
			sets:     []*agentexecutionv1.FileChangeSet{progressSet("exec:0", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING)},
			progress: nil,
			wantKept: false,
		},
		{
			name:     "empty change_set_id never matches",
			sets:     []*agentexecutionv1.FileChangeSet{progressSet("", agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_CAPTURING)},
			progress: progress(""),
			wantKept: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ReconcileFileChangeProgress(tt.sets, tt.progress)
			if tt.wantKept {
				if got == nil {
					t.Fatalf("expected progress to be kept, got nil")
				}
				if got != tt.progress {
					t.Fatalf("expected the same progress reference to be returned")
				}
			} else if got != nil {
				t.Fatalf("expected progress to be cleared (nil), got %+v", got)
			}
		})
	}
}
