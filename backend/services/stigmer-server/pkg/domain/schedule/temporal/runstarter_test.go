package temporal

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// fakeExecutionCreator records the create request and answers with a
// canned response or error.
type fakeExecutionCreator struct {
	created  *agentexecutionv1.AgentExecution
	response *agentexecutionv1.AgentExecution
	err      error
	// persistOnCreate mimics the real pipeline: the created execution
	// lands in the store, so a subsequent by-name lookup finds it.
	persistOnCreate store.Store
}

func (f *fakeExecutionCreator) Create(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	f.created = execution
	if f.err != nil {
		return nil, f.err
	}
	response := f.response
	if response == nil {
		// proto.Clone, never a struct copy: proto messages carry an
		// internal mutex, so copying trips vet's copylocks.
		clone := proto.Clone(execution).(*agentexecutionv1.AgentExecution)
		clone.Metadata = &apiresource.ApiResourceMetadata{
			Id:   "aex_01CREATED",
			Org:  execution.GetMetadata().GetOrg(),
			Name: execution.GetMetadata().GetName(),
			Slug: execution.GetMetadata().GetName(),
		}
		response = clone
	}
	if f.persistOnCreate != nil {
		if err := f.persistOnCreate.SaveResource(ctx,
			apiresourcekind.ApiResourceKind_agent_execution,
			response.GetMetadata().GetId(), response); err != nil {
			return nil, err
		}
	}
	return response, nil
}

func newStarterFixture(t *testing.T) (store.Store, *fakeExecutionCreator, *RunStarter) {
	t.Helper()
	st, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })
	creator := &fakeExecutionCreator{persistOnCreate: st}
	return st, creator, NewRunStarter(st, LoadConfig(), creator)
}

func seedAgent(t *testing.T, st store.Store) *agentv1.Agent {
	t.Helper()
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id: "agt_01TARGET", Org: "acme", Slug: "fee-bot", Name: "fee-bot"},
		Spec: &agentv1.AgentSpec{Instructions: "You send fee reminders."},
	}
	require.NoError(t, st.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent))
	return agent
}

var starterFireTime = time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC)

func TestScheduledExecutionName_PinnedByteForByte(t *testing.T) {
	// THE idempotency key, byte-identical to the cloud's
	// scheduledExecutionName (its test pins the same example) — two
	// editions must never name the same fire's run differently. Every
	// character is already slug-shaped, so the name survives the create
	// pipeline's slug generator unchanged.
	require.Equal(t, "sch-01test-20260803t090000z",
		ScheduledExecutionName("sch_01TEST", starterFireTime))
	require.Equal(t, "sch-01test-20260803t090000z",
		ScheduledExecutionName("sch_01TEST", starterFireTime.Add(400*time.Millisecond)),
		"sub-second fire times truncate — the whole-second granularity of the workflow-id suffix")
	require.NotEqual(t,
		ScheduledExecutionName("sch_01TEST", starterFireTime),
		ScheduledExecutionName("sch_01TEST", starterFireTime.Add(time.Second)),
		"two fires of one schedule never collide")
}

func TestComposeMessage_FireContextLineIsContract(t *testing.T) {
	st, _, _ := newStarterFixture(t)
	_ = st
	schedule := seedSchedule2(t, nil)

	// Byte-identical to the cloud's composeMessage output: the runner
	// injects no current date into any prompt, so this line is the only
	// way the model knows "today" — and both editions must say it the
	// same way. 09:00 UTC = 14:30 IST.
	require.Equal(t,
		"Send fee reminders.\n\n(Scheduled fire time: Monday, 2026-08-03 14:30 (Asia/Kolkata))",
		ComposeMessage(schedule, starterFireTime))
}

func TestComposeMessage_UnknownZoneDegradesToUTC(t *testing.T) {
	schedule := seedSchedule2(t, func(s *schedulev1.Schedule) { s.Spec.TimeZone = "Not/AZone" })
	require.Equal(t,
		"Send fee reminders.\n\n(Scheduled fire time: Monday, 2026-08-03 09:00 (UTC))",
		ComposeMessage(schedule, starterFireTime),
		"a slightly wrong-timezone reminder beats a dead fire")
}

// seedSchedule2 builds (without persisting) the starter tests' schedule.
func seedSchedule2(t *testing.T, mutate func(*schedulev1.Schedule)) *schedulev1.Schedule {
	t.Helper()
	schedule := &schedulev1.Schedule{
		Metadata: &apiresource.ApiResourceMetadata{
			Id: "sch_01TEST", Org: "acme", Slug: "fee-reminders", Name: "fee-reminders"},
		Spec: &schedulev1.ScheduleSpec{
			Cron: "0 9 * * *", TimeZone: "Asia/Kolkata", Enabled: true,
			Target: &schedulev1.ScheduleSpec_Agent{Agent: &agentexecutionv1.AgentInvocation{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent, Org: "acme", Slug: "fee-bot"},
				Message: "Send fee reminders.",
			}},
		},
		Status: &schedulev1.ScheduleStatus{},
	}
	if mutate != nil {
		mutate(schedule)
	}
	return schedule
}

func persistSchedule(t *testing.T, st store.Store, schedule *schedulev1.Schedule) {
	t.Helper()
	require.NoError(t, st.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, schedule.GetMetadata().GetId(), schedule))
}

func TestStartRun_ShapesTheUnattendedRun(t *testing.T) {
	st, creator, starter := newStarterFixture(t)
	seedAgent(t, st)
	schedule := seedSchedule2(t, nil)
	persistSchedule(t, st, schedule)

	outcome, err := starter.StartRun(context.Background(), schedule, starterFireTime)

	require.NoError(t, err)
	started, ok := outcome.(RunStartedOutcome)
	require.True(t, ok, "expected RunStartedOutcome, got %T", outcome)
	require.Equal(t, "aex_01CREATED", started.ExecutionID)
	require.False(t, started.AlreadyExisted)

	request := creator.created
	require.Equal(t, "sch-01test-20260803t090000z", request.GetMetadata().GetName(),
		"the deterministic name IS the request name")
	require.Equal(t, "acme", request.GetMetadata().GetOrg(),
		"OSS stamps the schedule's org directly — no token scope step exists here")
	require.Equal(t, "agt_01TARGET", request.GetSpec().GetAgentId())
	require.Contains(t, request.GetSpec().GetMessage(), "(Scheduled fire time: ")
	require.Equal(t, "Scheduled run: fee-reminders", request.GetSpec().GetSessionSpec().GetSubject(),
		"the pinned subject — which also opts the session out of LLM titling")
	require.Equal(t, agentexecutionv1.ApprovalMode_APPROVAL_MODE_UNATTENDED,
		request.GetSpec().GetExecutionConfig().GetApprovalMode(),
		"a gated tool with no approver would park the run forever — unattended is correctness")
	require.EqualValues(t, 20, request.GetSpec().GetExecutionConfig().GetMaxToolRounds())
	require.InDelta(t, 1.00, request.GetSpec().GetExecutionConfig().GetMaxCostUsd(), 0.001)
	require.Equal(t, agentexecutionv1.ServiceTier_SERVICE_TIER_UNSPECIFIED,
		request.GetSpec().GetExecutionConfig().GetServiceTier(),
		"no owner tier means unset — the runner resolves STANDARD, never the provider default")

	// The invocation's session half defaults to the platform: no owner
	// harness means unset (native applies), no workspace means none.
	require.Equal(t, sessionv1.Harness_HARNESS_UNSPECIFIED,
		request.GetSpec().GetSessionSpec().GetHarness())
	require.Empty(t, request.GetSpec().GetSessionSpec().GetWorkspaceEntries())

	// The run pointer landed on status.
	stored := &schedulev1.Schedule{}
	require.NoError(t, st.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, schedule.GetMetadata().GetId(), stored))
	require.Equal(t, "aex_01CREATED", stored.GetStatus().GetLastExecutionId())
}

func TestStartRun_CarriesTheInvocationSessionShape(t *testing.T) {
	// DD-018 D-3: the owner's harness, workspace, and run_config travel
	// from the invocation onto the fresh per-fire session and its
	// execution profile — model replaces the platform value outright,
	// bounds clamp min(owner, platform).
	st, creator, starter := newStarterFixture(t)
	seedAgent(t, st)
	schedule := seedSchedule2(t, func(s *schedulev1.Schedule) {
		invocation := s.GetSpec().GetAgent()
		invocation.Harness = sessionv1.Harness_HARNESS_CURSOR
		invocation.WorkspaceEntries = []*sessionv1.WorkspaceEntry{{
			Name: "docs",
			Source: &sessionv1.WorkspaceSource{Source: &sessionv1.WorkspaceSource_GitRepo{
				GitRepo: &sessionv1.GitRepoSource{Url: "https://github.com/acme/docs.git"},
			}},
		}}
		invocation.RunConfig = &agentexecutionv1.RunConfig{
			ModelName: "claude-sonnet-4-6",
			// Above the platform ceiling (1.00 / 20 in the fixture
			// config): the platform cap must win.
			MaxCostUsd:    5.00,
			MaxToolRounds: 100,
			ServiceTier:   agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
		}
	})
	persistSchedule(t, st, schedule)

	_, err := starter.StartRun(context.Background(), schedule, starterFireTime)
	require.NoError(t, err)

	sessionSpec := creator.created.GetSpec().GetSessionSpec()
	require.Equal(t, sessionv1.Harness_HARNESS_CURSOR, sessionSpec.GetHarness(),
		"the owner's harness choice reaches the session")
	require.Len(t, sessionSpec.GetWorkspaceEntries(), 1)
	require.Equal(t, "https://github.com/acme/docs.git",
		sessionSpec.GetWorkspaceEntries()[0].GetSource().GetGitRepo().GetUrl())

	config := creator.created.GetSpec().GetExecutionConfig()
	require.Equal(t, "claude-sonnet-4-6", config.GetModelName(),
		"model replaces the platform value outright — it is the owner's spend")
	require.InDelta(t, 1.00, config.GetMaxCostUsd(), 0.001,
		"the owner can lower spend, never raise it past the platform")
	require.EqualValues(t, 20, config.GetMaxToolRounds())
	require.Equal(t, agentexecutionv1.ServiceTier_SERVICE_TIER_FAST, config.GetServiceTier(),
		"the owner's stored tier is honored, not silently dropped (#357 write-time validation owns coherence)")
}

func TestStartRun_TheClockOwnsItsIdempotency(t *testing.T) {
	// DD-015 D-F: the OSS create pipeline deliberately has no duplicate
	// check, so a retried fire finds its own prior execution by the
	// deterministic name BEFORE creating — one reminder per fire, by
	// construction.
	st, creator, starter := newStarterFixture(t)
	seedAgent(t, st)
	schedule := seedSchedule2(t, nil)
	persistSchedule(t, st, schedule)

	first, err := starter.StartRun(context.Background(), schedule, starterFireTime)
	require.NoError(t, err)
	require.False(t, first.(RunStartedOutcome).AlreadyExisted)

	creator.created = nil
	second, err := starter.StartRun(context.Background(), schedule, starterFireTime)
	require.NoError(t, err)
	require.True(t, second.(RunStartedOutcome).AlreadyExisted, "the retry finds the winner")
	require.Equal(t, first.(RunStartedOutcome).ExecutionID, second.(RunStartedOutcome).ExecutionID)
	require.Nil(t, creator.created, "the retry must NOT create a second execution — that is the double reminder")
}

func TestStartRun_DanglingAgentIsTheDeterministicFailure(t *testing.T) {
	st, creator, starter := newStarterFixture(t)
	// No agent seeded: the reference dangles (deleted target — no
	// cascade by contract).
	schedule := seedSchedule2(t, nil)
	persistSchedule(t, st, schedule)

	outcome, err := starter.StartRun(context.Background(), schedule, starterFireTime)

	require.NoError(t, err)
	missing, ok := outcome.(RunTargetMissingOutcome)
	require.True(t, ok, "expected RunTargetMissingOutcome, got %T", outcome)
	require.Equal(t, "target agent acme/fee-bot not found", missing.Reason,
		"the start-failure copy is cross-edition contract — the pause reason builds on it")
	require.Nil(t, creator.created, "no execution may exist for a fire that could not resolve its target")
}

func TestStartRun_DeterministicRefusalsBecomeOutcomes(t *testing.T) {
	// A gate's refusal is a verdict for the streak; an infrastructure
	// failure is a retry. Conflating them either hides real failures or
	// pauses schedules on network blips.
	st, creator, starter := newStarterFixture(t)
	seedAgent(t, st)
	schedule := seedSchedule2(t, nil)
	persistSchedule(t, st, schedule)

	creator.err = status.Error(codes.FailedPrecondition, "the launch gate's own words")
	outcome, err := starter.StartRun(context.Background(), schedule, starterFireTime)
	require.NoError(t, err)
	refused, ok := outcome.(RunRefusedOutcome)
	require.True(t, ok, "expected RunRefusedOutcome, got %T", outcome)
	require.Equal(t, "the launch gate's own words", refused.Reason)

	creator.err = status.Error(codes.Unavailable, "engine down")
	_, err = starter.StartRun(context.Background(), schedule, starterFireTime)
	require.Error(t, err, "infrastructure failures propagate so the activity retries")
}

func TestStartRun_ModelPinningBackstop(t *testing.T) {
	// stigmer/stigmer#362: rows written before the write-time rule (an
	// explicit-cursor schedule with no pinned model) must refuse at fire
	// time — a deterministic verdict for the failure streak — instead of
	// running Auto at the provider account default's price.
	st, creator, starter := newStarterFixture(t)
	seedAgent(t, st)

	unpinned := seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Spec.GetAgent().Harness = sessionv1.Harness_HARNESS_CURSOR
	})
	persistSchedule(t, st, unpinned)

	outcome, err := starter.StartRun(context.Background(), unpinned, starterFireTime)
	require.NoError(t, err)
	refused, ok := outcome.(RunRefusedOutcome)
	require.True(t, ok, "expected RunRefusedOutcome, got %T", outcome)
	require.Equal(t,
		"spec.agent.run_config.model_name must name a pinned model when the run would use "+
			"the Cursor harness — with no pinned model Cursor runs Auto, whose price variant "+
			"follows the provider account's out-of-band default speed setting (stigmer/stigmer#362)",
		refused.Reason,
		"the copy matches the write-time rule — the fix is the same either way")
	require.Nil(t, creator.created, "no execution may exist for a refused fire")

	// A pinned model fires; the native default (unset harness) is exempt.
	pinned := seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Spec.GetAgent().Harness = sessionv1.Harness_HARNESS_CURSOR
		s.Spec.GetAgent().RunConfig = &agentexecutionv1.RunConfig{ModelName: "composer-2.5"}
	})
	persistSchedule(t, st, pinned)
	outcome, err = starter.StartRun(context.Background(), pinned, starterFireTime)
	require.NoError(t, err)
	require.IsType(t, RunStartedOutcome{}, outcome, "a pinned cursor schedule fires")

	native := seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Metadata.Id = "sch_01NATIVE"
	})
	persistSchedule(t, st, native)
	outcome, err = starter.StartRun(context.Background(), native, starterFireTime)
	require.NoError(t, err)
	require.IsType(t, RunStartedOutcome{}, outcome,
		"the native default is exempt — an empty model is deterministic there")
}
