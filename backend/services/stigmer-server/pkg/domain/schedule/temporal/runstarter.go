package temporal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// SessionSubjectPrefix is the scheduled session's pinned subject prefix —
// cross-edition contract (an explicit subject also opts the session out
// of LLM titling, deliberately: a reminder session names itself).
const SessionSubjectPrefix = "Scheduled run: "

// fireContextLayout renders the fire time for the prompt line — the Go
// spelling of the cloud's "EEEE, yyyy-MM-dd HH:mm". Byte-identical output
// is contract: the runner injects no current date into any prompt, so
// this line is the ONLY way the model knows "today".
const fireContextLayout = "Monday, 2006-01-02 15:04"

// executionNameFireTimeLayout renders the nominal fire time inside the
// deterministic execution name — the Go spelling of the cloud's
// "yyyyMMdd't'HHmmss'z'" (lowercase t/z are literals in a Go layout).
const executionNameFireTimeLayout = "20060102t150405z"

// RunOutcomeResult is the sealed outcome set of StartRun.
type RunOutcomeResult interface{ isRunOutcome() }

// RunStartedOutcome: the run exists (created now, or found from a prior
// attempt at the same fire).
type RunStartedOutcome struct {
	ExecutionID    string
	AlreadyExisted bool
}

// RunTargetMissingOutcome: the referenced agent no longer exists — the
// deterministic dangling-reference failure (no cascade by contract).
type RunTargetMissingOutcome struct{ Reason string }

// RunRefusedOutcome: a launch gate refused deterministically — retrying
// cannot help, the streak should know.
type RunRefusedOutcome struct{ Reason string }

func (RunStartedOutcome) isRunOutcome()       {}
func (RunTargetMissingOutcome) isRunOutcome() {}
func (RunRefusedOutcome) isRunOutcome()       {}

// ExecutionCreator is the narrow slice of the in-process agent-execution
// client the run starter needs (satisfied by downstream/agentexecution).
type ExecutionCreator interface {
	Create(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error)
}

// RunStarter turns one schedule fire into one AgentExecution — through
// the in-process gRPC client, so the FULL create pipeline runs (session
// auto-create, execution context, persist, workflow start). Where the
// cloud starter mints a schedule token and re-enters the pipeline behind
// FGA gates, OSS has no caller identity by design (DD-015 D-G): the org
// is stamped from the schedule's own metadata.
//
// Idempotency is the CLOCK's job here (DD-015 D-F): the OSS create
// pipeline deliberately has no duplicate check (it would tax every
// execution create in the product), so the starter looks up its own
// deterministic execution name before creating. Within one tick activity
// retries are sequential, and across fires the nominal time
// disambiguates — one reminder per fire, by construction.
type RunStarter struct {
	store     store.Store
	config    *Config
	executions ExecutionCreator
}

// NewRunStarter wires the starter.
func NewRunStarter(st store.Store, config *Config, executions ExecutionCreator) *RunStarter {
	return &RunStarter{store: st, config: config, executions: executions}
}

// ScheduledExecutionName is THE idempotency key: schedule id (lowercased,
// underscores to hyphens — already slug-safe) plus the nominal fire time
// truncated to whole seconds. Byte-identical to the cloud's
// scheduledExecutionName, pinned by tests on both sides: two editions
// must never name the same fire's run differently.
func ScheduledExecutionName(scheduleResourceID string, nominalFireTime time.Time) string {
	idPart := strings.ReplaceAll(strings.ToLower(scheduleResourceID), "_", "-")
	return idPart + "-" + nominalFireTime.UTC().Truncate(time.Second).Format(executionNameFireTimeLayout)
}

// ComposeMessage appends the fire-context line to the schedule's message,
// rendered in the schedule's own time zone (an unloadable zone degrades
// to UTC — a slightly wrong-timezone reminder beats a dead fire).
// Format-pinned: cloud produces the identical bytes.
func ComposeMessage(schedule *schedulev1.Schedule, nominalFireTime time.Time) string {
	zone, err := time.LoadLocation(schedule.GetSpec().GetTimeZone())
	if err != nil {
		zone = time.UTC
	}
	local := nominalFireTime.In(zone)
	return fmt.Sprintf("%s\n\n(Scheduled fire time: %s (%s))",
		schedule.GetSpec().GetAgent().GetMessage(), local.Format(fireContextLayout), zone.String())
}

// StartRun starts (or finds) this fire's run and stamps
// status.last_execution_id. Deterministic refusals come back as outcomes
// (the streak should count them); infrastructure failures come back as
// errors (the activity retries, the deterministic name absorbs it).
func (r *RunStarter) StartRun(ctx context.Context, schedule *schedulev1.Schedule, nominalFireTime time.Time) (RunOutcomeResult, error) {
	scheduleID := schedule.GetMetadata().GetId()
	org := schedule.GetMetadata().GetOrg()

	agent, missingReason, err := r.resolveTargetAgent(ctx, schedule)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		log.Warn().Str("schedule_id", scheduleID).Str("reason", missingReason).
			Msg("Schedule fire has no target agent")
		return RunTargetMissingOutcome{Reason: missingReason}, nil
	}

	executionName := ScheduledExecutionName(scheduleID, nominalFireTime)

	// The clock's own idempotency: a retried activity (or a duplicated
	// fire at the same nominal time) finds the winner instead of sending
	// the reminder twice. The deterministic name IS the execution's slug
	// (every character is already slug-shaped, pinned by test).
	if existing, found, findErr := steps.FindResourceBySlug[*agentexecutionv1.AgentExecution](
		ctx, r.store, apiresourcekind.ApiResourceKind_agent_execution, executionName, org); findErr != nil {
		return nil, fmt.Errorf("look up execution %s: %w", executionName, findErr)
	} else if found {
		executionID := existing.GetMetadata().GetId()
		log.Info().Str("schedule_id", scheduleID).Str("execution_id", executionID).
			Msg("Schedule fire already has its execution (idempotent retry)")
		if stampErr := r.stampLastExecutionID(ctx, scheduleID, executionID); stampErr != nil {
			return nil, stampErr
		}
		return RunStartedOutcome{ExecutionID: executionID, AlreadyExisted: true}, nil
	}

	created, err := r.executions.Create(ctx, r.buildExecutionRequest(schedule, agent, executionName, nominalFireTime))
	if err != nil {
		grpcStatus, ok := status.FromError(err)
		if !ok {
			return nil, err
		}
		switch grpcStatus.Code() {
		case codes.AlreadyExists:
			// The session auto-create's duplicate check can refuse even
			// though the execution create has none — re-read the winner.
			existing, found, findErr := steps.FindResourceBySlug[*agentexecutionv1.AgentExecution](
				ctx, r.store, apiresourcekind.ApiResourceKind_agent_execution, executionName, org)
			if findErr != nil || !found {
				return nil, fmt.Errorf("duplicate-check refusal but no execution row for %s: %w",
					executionName, err)
			}
			executionID := existing.GetMetadata().GetId()
			if stampErr := r.stampLastExecutionID(ctx, scheduleID, executionID); stampErr != nil {
				return nil, stampErr
			}
			return RunStartedOutcome{ExecutionID: executionID, AlreadyExisted: true}, nil
		case codes.FailedPrecondition, codes.PermissionDenied, codes.NotFound,
			codes.InvalidArgument, codes.ResourceExhausted:
			log.Error().Str("schedule_id", scheduleID).Str("org", org).
				Str("code", grpcStatus.Code().String()).Str("reason", grpcStatus.Message()).
				Msg("Schedule fire refused by a launch gate")
			return RunRefusedOutcome{Reason: grpcStatus.Message()}, nil
		default:
			return nil, err
		}
	}

	executionID := created.GetMetadata().GetId()
	if stampErr := r.stampLastExecutionID(ctx, scheduleID, executionID); stampErr != nil {
		return nil, stampErr
	}
	return RunStartedOutcome{ExecutionID: executionID}, nil
}

// resolveTargetAgent loads the referenced agent, the reference's org
// defaulting to the schedule's own. A nil agent with a reason means the
// deterministic dangling-reference failure.
func (r *RunStarter) resolveTargetAgent(ctx context.Context, schedule *schedulev1.Schedule) (*agentv1.Agent, string, error) {
	ref := schedule.GetSpec().GetAgent().GetAgentRef()
	if ref.GetSlug() == "" {
		return nil, "schedule has no agent target", nil
	}
	org := ref.GetOrg()
	if org == "" {
		org = schedule.GetMetadata().GetOrg()
	}
	agent, found, err := steps.FindResourceBySlug[*agentv1.Agent](
		ctx, r.store, apiresourcekind.ApiResourceKind_agent, ref.GetSlug(), org)
	if err != nil {
		return nil, "", fmt.Errorf("resolve target agent %s/%s: %w", org, ref.GetSlug(), err)
	}
	if !found {
		// The deterministic start-failure copy — cross-edition contract
		// (the conformance firing suite asserts the pause reason built
		// from it, byte-for-byte).
		return nil, fmt.Sprintf("target agent %s/%s not found", org, ref.GetSlug()), nil
	}
	return agent, "", nil
}

// buildExecutionRequest shapes the run: fresh session per fire with the
// pinned subject, the fire-context message, and the unattended execution
// profile. approval_mode=UNATTENDED is a correctness requirement, not a
// preference: a gated tool with no approver would park the execution
// forever (the agent workflow deliberately has no run timeout), which
// under tracking becomes a silently-burned budget every fire.
func (r *RunStarter) buildExecutionRequest(
	schedule *schedulev1.Schedule,
	agent *agentv1.Agent,
	executionName string,
	nominalFireTime time.Time,
) *agentexecutionv1.AgentExecution {
	executionConfig := &agentexecutionv1.ExecutionConfig{
		ApprovalMode: agentexecutionv1.ApprovalMode_APPROVAL_MODE_UNATTENDED,
	}
	if r.config.ExecutionProfileMaxToolRounds > 0 {
		executionConfig.MaxToolRounds = int32(r.config.ExecutionProfileMaxToolRounds)
	}
	if r.config.ExecutionProfileMaxCostUsd > 0 {
		executionConfig.MaxCostUsd = r.config.ExecutionProfileMaxCostUsd
	}

	return &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: executionName,
			// Cloud deliberately omits the org (its token scope step
			// forces it from the validated claim); OSS has no token, so
			// the schedule's own org is stamped directly — it is
			// load-bearing for the session and execution context.
			Org: schedule.GetMetadata().GetOrg(),
		},
		Spec: &agentexecutionv1.AgentExecutionSpec{
			AgentId: agent.GetMetadata().GetId(),
			Message: ComposeMessage(schedule, nominalFireTime),
			SessionSpec: &sessionv1.SessionSpec{
				Subject: SessionSubjectPrefix + schedule.GetMetadata().GetSlug(),
			},
			ExecutionConfig: executionConfig,
		},
	}
}

// stampLastExecutionID records the run pointer on status. Failing this
// write returns an error so the activity retries and converges the
// pointer — the deterministic name makes the retry harmless.
func (r *RunStarter) stampLastExecutionID(ctx context.Context, scheduleID string, executionID string) error {
	updated := &schedulev1.Schedule{}
	err := r.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		scheduleID, updated, func() error {
			status := ensureStatus(updated)
			status.LastExecutionId = executionID
			bumpStatusAudit(status, time.Now())
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil // deleted mid-fire: nothing to stamp
		}
		return fmt.Errorf("stamp last_execution_id on schedule %s: %w", scheduleID, err)
	}
	return nil
}
