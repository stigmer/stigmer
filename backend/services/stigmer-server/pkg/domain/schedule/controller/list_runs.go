package schedule

import (
	"context"
	"errors"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const listRunsResultKey = "listRunsResult"

// defaultRunsPageSize bounds an unpaginated listRuns read — history can
// hold a quarter's worth of daily fires, and "the recent runs" is the
// question the surface answers.
const defaultRunsPageSize = 50

// ListRuns retrieves a schedule's run history, newest first — the fire
// ledger surface (project DD-017 D-7). Every fire leaves a row,
// INCLUDING fires that created no execution (a refused launch gate, a
// missing target agent), with the refusing gate's copy verbatim: this is
// the RPC that explains status.consecutive_failures.
//
// Rows carrying an execution id but no terminal outcome are enriched
// with the execution's LIVE phase at read time — manual fires are
// untracked by design (the caller watches the execution), so their
// outcome is resolved here rather than by a tracker, and outcome columns
// never lie while a run is in flight.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (schedule_id)
//  2. LoadScheduleForRuns - Load the schedule (NOT_FOUND if missing)
//  3. ListRunsFromLedger - Page the ledger, enrich in-flight rows
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth; cloud requires can_view on the schedule).
func (c *ScheduleController) ListRuns(ctx context.Context, req *schedulev1.ListScheduleRunsRequest) (*schedulev1.ScheduleRunList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := pipeline.NewPipeline[*schedulev1.ListScheduleRunsRequest]("schedule-list-runs").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ListScheduleRunsRequest]()).
		AddStep(&loadScheduleForRunsStep{store: c.store}).
		AddStep(&listRunsFromLedgerStep{store: c.store}).
		Build()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list, ok := reqCtx.Get(listRunsResultKey).(*schedulev1.ScheduleRunList)
	if !ok || list == nil {
		return nil, grpclib.InternalError(nil, "schedule run list not found in context")
	}
	return list, nil
}

// loadScheduleForRunsStep confirms the schedule exists — a missing
// schedule answers NOT_FOUND, never an empty history that reads as
// "exists but never fired".
type loadScheduleForRunsStep struct {
	store store.Store
}

func (s *loadScheduleForRunsStep) Name() string {
	return "LoadScheduleForRuns"
}

func (s *loadScheduleForRunsStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ListScheduleRunsRequest]) error {
	scheduleID := ctx.Input().GetScheduleId()
	schedule := &schedulev1.Schedule{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_schedule, scheduleID, schedule)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Schedule", scheduleID)
		}
		return grpclib.InternalError(err, "failed to load schedule")
	}
	return nil
}

// listRunsFromLedgerStep pages the fire ledger (newest first) and
// enriches in-flight rows with the execution's live phase.
type listRunsFromLedgerStep struct {
	store store.Store
}

func (s *listRunsFromLedgerStep) Name() string {
	return "ListRunsFromLedger"
}

func (s *listRunsFromLedgerStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ListScheduleRunsRequest]) error {
	req := ctx.Input()

	// PageInfo.num is 1-indexed by contract (pagination.proto — the
	// session-19 production lesson); a zero/absent page reads as the
	// first.
	size := int(req.GetPageInfo().GetSize())
	if size <= 0 {
		size = defaultRunsPageSize
	}
	num := int(req.GetPageInfo().GetNum())
	if num < 1 {
		num = 1
	}
	offset := (num - 1) * size

	records, total, err := s.store.ListScheduleRuns(ctx.Context(), req.GetScheduleId(), offset, size)
	if err != nil {
		return grpclib.InternalError(err, "failed to list schedule runs")
	}

	items := make([]*schedulev1.ScheduleRun, 0, len(records))
	for _, record := range records {
		items = append(items, s.toProtoRun(ctx.Context(), record))
	}

	ctx.Set(listRunsResultKey, &schedulev1.ScheduleRunList{
		TotalCount: int32(total),
		Items:      items,
	})
	return nil
}

// toProtoRun maps one ledger row to the wire, enriching a non-terminal
// row that carries an execution id with the execution's live phase — the
// read-time honesty rule (DD-017 D-7).
func (s *listRunsFromLedgerStep) toProtoRun(ctx context.Context, record *store.ScheduleRunRecord) *schedulev1.ScheduleRun {
	run := &schedulev1.ScheduleRun{
		ScheduleId:  record.ScheduleID,
		Org:         record.Org,
		Origin:      runOriginFromLabel(record.Origin),
		Outcome:     runOutcomeFromLabel(record.Outcome),
		Reason:      record.Reason,
		ExecutionId: record.ExecutionID,
	}
	if t, err := time.Parse(time.RFC3339, record.NominalFireTime); err == nil {
		run.NominalFireTime = timestamppb.New(t)
	}
	if t, err := time.Parse(time.RFC3339, record.RecordedAt); err == nil {
		run.RecordedAt = timestamppb.New(t)
	}
	if record.CompletedAt != "" {
		if t, err := time.Parse(time.RFC3339, record.CompletedAt); err == nil {
			run.CompletedAt = timestamppb.New(t)
		}
		return run
	}

	// In flight on paper — ask the execution row what actually happened.
	if record.ExecutionID == "" {
		return run
	}
	execution := &agentexecutionv1.AgentExecution{}
	if err := s.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution,
		record.ExecutionID, execution); err != nil {
		// Execution deleted (or unreadable): the ledger row stands as
		// recorded — deleting a run must not rewrite its history.
		return run
	}
	switch execution.GetStatus().GetPhase() {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		run.Outcome = schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_COMPLETED
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		run.Outcome = schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_FAILED
		run.Reason = "run " + record.ExecutionID + " ended " +
			executionPhaseWord(execution.GetStatus().GetPhase())
	default:
		// Genuinely still running — "started" is the honest answer.
	}
	return run
}

// executionPhaseWord lowers an ExecutionPhase to the reason vocabulary
// the tick's verdict writer uses ("run X ended execution_failed").
func executionPhaseWord(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "failed"
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "cancelled"
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "terminated"
	default:
		return "unknown"
	}
}

// runOriginFromLabel maps the ledger's lowercase origin vocabulary back
// to the wire enum.
func runOriginFromLabel(origin string) schedulev1.ScheduleRunOrigin {
	switch origin {
	case "cron":
		return schedulev1.ScheduleRunOrigin_SCHEDULE_RUN_ORIGIN_CRON
	case "manual":
		return schedulev1.ScheduleRunOrigin_SCHEDULE_RUN_ORIGIN_MANUAL
	default:
		return schedulev1.ScheduleRunOrigin_SCHEDULE_RUN_ORIGIN_UNSPECIFIED
	}
}

// runOutcomeFromLabel maps the ledger's lowercase outcome vocabulary back
// to the wire enum.
func runOutcomeFromLabel(outcome string) schedulev1.ScheduleRunOutcome {
	switch outcome {
	case "started":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_STARTED
	case "refused":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_REFUSED
	case "target_missing":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_TARGET_MISSING
	case "skipped":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_SKIPPED
	case "completed":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_COMPLETED
	case "failed":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_FAILED
	case "timed_out":
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_TIMED_OUT
	default:
		return schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_UNSPECIFIED
	}
}
