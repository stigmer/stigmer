package replay

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/executor"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// TestReplay_WorkflowHistories replays all committed gold master event histories
// against the current ExecuteServerlessWorkflow code. A failure means the
// workflow's command sequence has changed in a way that is incompatible with
// in-flight executions — either add workflow.GetVersion() to handle both paths,
// or regenerate the histories with `make capture-replay-histories`.
//
// Activities are not registered with the replayer because replay only verifies
// the workflow's deterministic command sequence (which activities to schedule,
// in which order, with what options). Activity code is never executed during replay.
func TestReplay_WorkflowHistories(t *testing.T) {
	historiesDir := filepath.Join("testdata", "replay-histories")

	entries, err := os.ReadDir(historiesDir)
	if err != nil {
		t.Skipf("no replay histories directory at %s — run `make capture-replay-histories` to generate", historiesDir)
		return
	}

	var historyFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			historyFiles = append(historyFiles, filepath.Join(historiesDir, entry.Name()))
		}
	}

	if len(historyFiles) == 0 {
		t.Skipf("no .json history files in %s — run `make capture-replay-histories` to generate", historiesDir)
		return
	}

	replayer := worker.NewWorkflowReplayer()

	replayer.RegisterWorkflowWithOptions(
		executor.ExecuteServerlessWorkflow,
		workflow.RegisterOptions{Name: "ExecuteServerlessWorkflow"},
	)

	t.Logf("replaying %d history files", len(historyFiles))

	for _, historyFile := range historyFiles {
		name := strings.TrimSuffix(filepath.Base(historyFile), ".json")
		t.Run(name, func(t *testing.T) {
			err := replayer.ReplayWorkflowHistoryFromJSONFile(nil, historyFile)
			require.NoError(t, err,
				"replay failed for %s — this means the workflow's command sequence has changed.\n"+
					"If the change is intentional, add workflow.GetVersion() for backward compatibility\n"+
					"and regenerate histories with `make capture-replay-histories`.",
				name,
			)
		})
	}
}
