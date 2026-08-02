package temporal

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/encoding/protojson"
)

// TestCapture_TickReplayHistories regenerates the replay gate's committed
// gold masters from REAL fires against a real Temporal dev server — the
// reproducible capture tool living beside the test that consumes it.
// Guarded by an env var so ordinary runs skip it (the REPLAY test, by
// contrast, never skips):
//
//	STIGMER_CAPTURE_TICK_HISTORY=1 go test ./pkg/domain/schedule/temporal/ \
//	  -run TestCapture_TickReplayHistories -count=1
//
// Regenerate ONLY when the old histories are genuinely obsolete (no
// release that produced them is still supported) — never to make a red
// replay gate green, which is the gate telling you to use
// workflow.GetVersion.
//
// Three scenarios cover every branch shape the tick's history can take:
// the revalidation no-op, the start-failure verdict, and a tracked run
// (timer loop + success verdict). The tracked run needs no runner: a
// fake execution creator persists the row and a background flip drives
// its phase to COMPLETED mid-track.
func TestCapture_TickReplayHistories(t *testing.T) {
	if os.Getenv("STIGMER_CAPTURE_TICK_HISTORY") == "" {
		t.Skip("capture tool — set STIGMER_CAPTURE_TICK_HISTORY=1 to regenerate the replay gold masters")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	temporalAddress := startTemporalDevServer(t)
	temporalClient, err := client.Dial(client.Options{HostPort: temporalAddress})
	require.NoError(t, err)
	t.Cleanup(temporalClient.Close)

	st, err := sqlite.NewStore(t.TempDir() + "/capture.sqlite")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	config := LoadConfig()
	provider := func() client.Client { return temporalClient }
	syncer := NewSyncer(provider, st, NewArtifact(config))
	creator := &capturingExecutionCreator{store: st}
	activities := NewTickActivities(st, config, syncer, NewRunStarter(st, config, creator))

	worker := NewWorkerConfig(config, activities).CreateWorker(temporalClient)
	require.NoError(t, worker.Start())
	t.Cleanup(worker.Stop)

	outputDir := filepath.Join("testdata", "replay-histories")
	require.NoError(t, os.MkdirAll(outputDir, 0o755))

	// Scenario 1: a tracked run that completes — the fullest history
	// (record, start, poll loop with timers, success verdict).
	t.Run("tick-completed-run", func(t *testing.T) {
		schedule := captureSeedSchedule(t, st, "sch_01CAPTUREOK", true, "")
		captureSeedAgent(t, st, "acme", "fee-bot")
		creator.completeAfter = 3 * time.Second

		captureFire(t, ctx, temporalClient, st, syncer, schedule,
			filepath.Join(outputDir, "tick-completed-run.json"))
	})

	// Scenario 2: a dangling target — the start-failure verdict path.
	t.Run("tick-start-failed", func(t *testing.T) {
		schedule := captureSeedSchedule(t, st, "sch_01CAPTUREDANGLE", true, "")
		// No agent seeded for this schedule's org: deterministic failure.
		schedule.Spec.GetAgent().AgentRef.Org = "nowhere"
		require.NoError(t, st.SaveResource(ctx, apiresourcekind.ApiResourceKind_schedule,
			schedule.GetMetadata().GetId(), schedule))

		captureFire(t, ctx, temporalClient, st, syncer, schedule,
			filepath.Join(outputDir, "tick-start-failed.json"))
	})

	// Scenario 3: the revalidation no-op (owner-disabled).
	t.Run("tick-skipped-disabled", func(t *testing.T) {
		schedule := captureSeedSchedule(t, st, "sch_01CAPTUREOFF", true, "")
		_, err := syncer.EnsureAndRecord(ctx, schedule)
		require.NoError(t, err)
		// Disable AFTER arming, so the artifact still fires the tick and
		// the tick's own revalidation declines it.
		schedule.Spec.Enabled = false
		require.NoError(t, st.SaveResource(ctx, apiresourcekind.ApiResourceKind_schedule,
			schedule.GetMetadata().GetId(), schedule))

		require.NoError(t, syncer.Trigger(ctx, schedule.GetMetadata().GetId()))
		workflowID, runID := awaitTickCompletion(t, ctx, temporalClient, schedule.GetMetadata().GetId())
		writeHistory(t, ctx, temporalClient, workflowID, runID,
			filepath.Join(outputDir, "tick-skipped-disabled.json"))
	})
}

// captureFire arms, triggers, awaits the tick, and writes its history.
func captureFire(t *testing.T, ctx context.Context, temporalClient client.Client,
	st store.Store, syncer *Syncer, schedule *schedulev1.Schedule, outputPath string) {
	t.Helper()
	_, err := syncer.EnsureAndRecord(ctx, schedule)
	require.NoError(t, err)
	require.NoError(t, syncer.Trigger(ctx, schedule.GetMetadata().GetId()))
	workflowID, runID := awaitTickCompletion(t, ctx, temporalClient, schedule.GetMetadata().GetId())
	writeHistory(t, ctx, temporalClient, workflowID, runID, outputPath)
}

// awaitTickCompletion finds the triggered fire through the artifact's
// recent actions and waits for its workflow to finish.
func awaitTickCompletion(t *testing.T, ctx context.Context, temporalClient client.Client,
	scheduleResourceID string) (workflowID string, runID string) {
	t.Helper()
	handle := temporalClient.ScheduleClient().GetHandle(ctx, ArtifactID(scheduleResourceID))
	require.Eventually(t, func() bool {
		desc, err := handle.Describe(ctx)
		if err != nil || len(desc.Info.RecentActions) == 0 {
			return false
		}
		last := desc.Info.RecentActions[len(desc.Info.RecentActions)-1]
		if last.StartWorkflowResult == nil {
			return false
		}
		workflowID = last.StartWorkflowResult.WorkflowID
		runID = last.StartWorkflowResult.FirstExecutionRunID
		return true
	}, 30*time.Second, 250*time.Millisecond, "the triggered fire never started")

	require.NoError(t,
		temporalClient.GetWorkflow(ctx, workflowID, runID).Get(ctx, nil),
		"the tick must complete successfully before its history is a gold master")
	return workflowID, runID
}

// writeHistory exports the workflow's full event history in the same
// protojson shape `temporal workflow show --output json` emits — the
// format ReplayWorkflowHistoryFromJSONFile parses.
func writeHistory(t *testing.T, ctx context.Context, temporalClient client.Client,
	workflowID string, runID string, outputPath string) {
	t.Helper()
	var events []*historypb.HistoryEvent
	iter := temporalClient.GetWorkflowHistory(ctx, workflowID, runID, false,
		enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for iter.HasNext() {
		event, err := iter.Next()
		require.NoError(t, err)
		events = append(events, event)
	}
	data, err := protojson.MarshalOptions{Indent: "  "}.Marshal(&historypb.History{Events: events})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(outputPath, data, 0o644))
	t.Logf("captured %d events -> %s", len(events), outputPath)
}

// capturingExecutionCreator persists the run's row directly (no runner in
// the capture stack) and, when completeAfter is set, flips its phase to
// COMPLETED in the background so the tick's tracking loop observes a
// genuine RUNNING -> COMPLETED transition across at least one timer.
type capturingExecutionCreator struct {
	store         store.Store
	completeAfter time.Duration
}

func (c *capturingExecutionCreator) Create(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	created := &agentexecutionv1.AgentExecution{
		ApiVersion: execution.GetApiVersion(),
		Kind:       execution.GetKind(),
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "aex_01capture" + fmt.Sprintf("%d", time.Now().UnixNano()),
			Org:  execution.GetMetadata().GetOrg(),
			Name: execution.GetMetadata().GetName(),
			Slug: execution.GetMetadata().GetName(),
		},
		Spec:   execution.GetSpec(),
		Status: &agentexecutionv1.AgentExecutionStatus{Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS},
	}
	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution,
		created.GetMetadata().GetId(), created); err != nil {
		return nil, err
	}
	if c.completeAfter > 0 {
		go func(id string, after time.Duration) {
			time.Sleep(after)
			updated := &agentexecutionv1.AgentExecution{}
			_ = c.store.UpdateResource(context.Background(),
				apiresourcekind.ApiResourceKind_agent_execution, id, updated, func() error {
					if updated.Status == nil {
						updated.Status = &agentexecutionv1.AgentExecutionStatus{}
					}
					updated.Status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED
					return nil
				})
		}(created.GetMetadata().GetId(), c.completeAfter)
	}
	return created, nil
}

func captureSeedAgent(t *testing.T, st store.Store, org string, slug string) {
	t.Helper()
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id: "agt_01capture" + slug, Org: org, Slug: slug, Name: slug},
		Spec: &agentv1.AgentSpec{Instructions: "You send fee reminders."},
	}
	require.NoError(t, st.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent))
}

func captureSeedSchedule(t *testing.T, st store.Store, id string, enabled bool, pausedReason string) *schedulev1.Schedule {
	t.Helper()
	schedule := &schedulev1.Schedule{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Schedule",
		Metadata: &apiresource.ApiResourceMetadata{
			Id: id, Org: "acme", Slug: "capture-" + id, Name: "capture-" + id},
		Spec: &schedulev1.ScheduleSpec{
			Cron: "0 9 * * *", TimeZone: "Asia/Kolkata", Enabled: enabled,
			Target: &schedulev1.ScheduleSpec_Agent{Agent: &schedulev1.AgentTarget{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent, Org: "acme", Slug: "fee-bot"},
				Message: "Send fee reminders.",
			}},
		},
		Status: &schedulev1.ScheduleStatus{},
	}
	if pausedReason != "" {
		schedule.Status.PausedReason = pausedReason
	}
	require.NoError(t, st.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, id, schedule))
	return schedule
}

// startTemporalDevServer boots `temporal server start-dev` on a free port
// (the integration harness's shape) and tears it down with the test.
func startTemporalDevServer(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())

	cmd := exec.Command("temporal", "server", "start-dev",
		"--port", fmt.Sprintf("%d", port), "--namespace", "default",
		"--headless", "--log-format", "json")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})

	address := fmt.Sprintf("127.0.0.1:%d", port)
	require.Eventually(t, func() bool {
		conn, dialErr := net.DialTimeout("tcp", address, time.Second)
		if dialErr != nil {
			return false
		}
		conn.Close()
		return true
	}, 30*time.Second, 500*time.Millisecond, "temporal dev server never became reachable")
	return address
}
