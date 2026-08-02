package temporal

import (
	"path/filepath"
	"testing"

	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// TestReplay_TickWorkflowDeterminism replays the committed gold-master
// histories against the CURRENT tick workflow body. A failure means the
// body changed in a way that breaks in-flight ticks on a user's machine
// — and OSS releases cut every 1-3 days, so an in-flight tick straddling
// a binary upgrade is the expected case, not the edge. Fix by gating the
// change with workflow.GetVersion, never by regenerating the histories
// (regenerate only when the old histories are genuinely obsolete — i.e.
// no release that produced them is still supported).
//
// This test is deliberately its own skip-guard: an empty histories
// directory FAILS instead of skipping. The previous replay gate spent
// months silently pointing at a deleted directory; a determinism gate
// that can quietly stop testing is worse than none, because it keeps
// paying out confidence.
//
// Histories are captured from a live fire (the conformance
// local-go-execution stack) via:
//
//	temporal workflow show --workflow-id 'schedule/tick/<id>-<ts>' \
//	  --output json > testdata/replay-histories/<name>.json
func TestReplay_TickWorkflowDeterminism(t *testing.T) {
	histories, err := filepath.Glob(filepath.Join("testdata", "replay-histories", "*.json"))
	if err != nil {
		t.Fatalf("glob replay histories: %v", err)
	}
	if len(histories) == 0 {
		t.Fatal("no committed replay histories in testdata/replay-histories/ — " +
			"the determinism gate has nothing to test, which is a failure, not a skip " +
			"(see this test's doc comment for how histories are captured)")
	}

	for _, history := range histories {
		history := history
		t.Run(filepath.Base(history), func(t *testing.T) {
			replayer := worker.NewWorkflowReplayer()
			replayer.RegisterWorkflowWithOptions(
				(&TickWorkflow{}).Run,
				workflow.RegisterOptions{Name: TickWorkflowType},
			)
			if err := replayer.ReplayWorkflowHistoryFromJSONFile(nil, history); err != nil {
				t.Errorf("tick workflow no longer replays %s deterministically: %v\n"+
					"An in-flight tick would break on upgrade — gate the change with "+
					"workflow.GetVersion", filepath.Base(history), err)
			}
		})
	}
}
