package schedule

import (
	"context"
	"fmt"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The exact error strings shared with the cloud edition (the
// backend-engineer rule: same error contracts in both editions). Sourced
// from ScheduleDefaultsResolver and ScheduleUpdateHandler
// .ValidateScheduleUpdate in stigmer-cloud; a change on either side must
// change both.
const (
	crossOrgMessage     = "spec.agent.agent_ref.org must match metadata.org — a schedule must live in the referenced agent's organization (%s)"
	refImmutableMessage = "spec.agent.agent_ref is immutable (schedule runs %s/%s) — create a new schedule to run a different agent"
	orgRequiredMessage  = "metadata.org is required for a schedule"
)

// contextWithKind simulates the apiresource interceptor, which injects the
// RPC's resource kind into the request context in production.
func contextWithKind(kind apiresourcekind.ApiResourceKind) context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, kind)
}

func scheduleCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_schedule)
}

func agentCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_agent)
}

type testControllers struct {
	store     store.Store
	schedules *ScheduleController
	agents    *agentcontroller.AgentController
}

func newTestControllers(t *testing.T) *testControllers {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return &testControllers{
		store:     s,
		schedules: NewScheduleController(s),
		agents:    agentcontroller.NewAgentController(s, nil),
	}
}

func createTestAgentInOrg(t *testing.T, tc *testControllers, name, org string) *agentv1.Agent {
	t.Helper()
	created, err := tc.agents.Create(agentCtx(), &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Agent for schedule tests",
			Instructions: "You are a helpful agent for schedule verification.",
		},
	})
	if err != nil {
		t.Fatalf("agent Create failed: %v", err)
	}
	return created
}

func createTestAgent(t *testing.T, tc *testControllers, name string) *agentv1.Agent {
	t.Helper()
	return createTestAgentInOrg(t, tc, name, "test-org")
}

// scheduleFor builds a named daily schedule for an agent. Like channels
// (P7: N-per-agent), schedules have no canonical-slug default, so tests
// always provide a name for the generic derive-from-name slug.
func scheduleFor(agent *agentv1.Agent, name string, enabled bool) *schedulev1.Schedule {
	return &schedulev1.Schedule{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Schedule",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &schedulev1.ScheduleSpec{
			Cron:     "0 9 * * *",
			TimeZone: "Asia/Kolkata",
			Enabled:  enabled,
			Target: &schedulev1.ScheduleSpec_Agent{
				Agent: &schedulev1.AgentTarget{
					AgentRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_agent,
						Slug: agent.GetMetadata().GetSlug(),
					},
					Message: "Send fee reminders to members whose dues fall in the next 3 days.",
				},
			},
		},
	}
}

func createTestSchedule(t *testing.T, tc *testControllers, agent *agentv1.Agent, name string, enabled bool) *schedulev1.Schedule {
	t.Helper()
	created, err := tc.schedules.Create(scheduleCtx(), scheduleFor(agent, name, enabled))
	if err != nil {
		t.Fatalf("schedule Create failed: %v", err)
	}
	return created
}

func TestScheduleCreate(t *testing.T) {
	t.Run("creates with sch id prefix, normalized ref, and empty status", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "reminder-agent")

		created := createTestSchedule(t, tc, agent, "daily-fee-reminders", true)

		if !strings.HasPrefix(created.GetMetadata().GetId(), "sch_") {
			t.Errorf("expected sch_ id prefix, got %s", created.GetMetadata().GetId())
		}
		if created.GetMetadata().GetSlug() != "daily-fee-reminders" {
			t.Errorf("expected derive-from-name slug, got %s", created.GetMetadata().GetSlug())
		}
		// The relative reference was made absolute at write time.
		if got := created.GetSpec().GetAgent().GetAgentRef().GetOrg(); got != "test-org" {
			t.Errorf("agent_ref.org should be normalized to test-org, got %q", got)
		}
		// Status is platform-owned and starts EMPTY: nothing fires until
		// the clock lands, and no client may seed firing observations.
		if created.GetStatus().GetConsecutiveFailures() != 0 ||
			created.GetStatus().GetPausedReason() != "" ||
			created.GetStatus().GetLastExecutionId() != "" ||
			created.GetStatus().GetNextFireAt() != nil {
			t.Errorf("status should start empty, got %v", created.GetStatus())
		}
	})

	t.Run("client-provided status is wiped on create", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "status-seed-agent")

		schedule := scheduleFor(agent, "status-seeding-attempt", true)
		schedule.Status = &schedulev1.ScheduleStatus{
			ConsecutiveFailures: 7,
			PausedReason:        "client-forged pause",
		}

		created, err := tc.schedules.Create(scheduleCtx(), schedule)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		if created.GetStatus().GetConsecutiveFailures() != 0 || created.GetStatus().GetPausedReason() != "" {
			t.Errorf("client-provided status must be wiped, got %v", created.GetStatus())
		}
	})

	t.Run("requires metadata.org", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "orgless-agent")

		schedule := scheduleFor(agent, "orgless", true)
		schedule.Metadata.Org = ""

		_, err := tc.schedules.Create(scheduleCtx(), schedule)
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected INVALID_ARGUMENT, got %s (%v)", status.Code(err), err)
		}
		if !strings.Contains(err.Error(), orgRequiredMessage) {
			t.Errorf("expected the org-required message, got: %v", err)
		}
	})

	t.Run("rejects a cross-org agent reference before probing slugs", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "same-org-agent")

		schedule := scheduleFor(agent, "cross-org", true)
		schedule.Spec.GetAgent().AgentRef.Org = "some-foreign-org"

		_, err := tc.schedules.Create(scheduleCtx(), schedule)
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION, got %s (%v)", status.Code(err), err)
		}
		want := strings.Replace(crossOrgMessage, "%s", "some-foreign-org", 1)
		if !strings.Contains(err.Error(), want) {
			t.Errorf("expected the cross-org message, got: %v", err)
		}
	})

	t.Run("rejects a nonexistent agent with the direct-lookup refusal", func(t *testing.T) {
		tc := newTestControllers(t)

		schedule := &schedulev1.Schedule{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Schedule",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "ghost", Org: "test-org"},
			Spec: &schedulev1.ScheduleSpec{
				Cron:     "0 9 * * *",
				TimeZone: "UTC",
				Enabled:  true,
				Target: &schedulev1.ScheduleSpec_Agent{
					Agent: &schedulev1.AgentTarget{
						AgentRef: &apiresource.ApiResourceReference{
							Kind: apiresourcekind.ApiResourceKind_agent,
							Slug: "no-such-agent",
						},
						Message: "hello",
					},
				},
			},
		}

		_, err := tc.schedules.Create(scheduleCtx(), schedule)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for a schedule of a nonexistent agent, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("rejects bad cron and bad timezone at create", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "cron-guard-agent")

		badCron := scheduleFor(agent, "bad-cron", true)
		badCron.Spec.Cron = "@every 30s"
		if _, err := tc.schedules.Create(scheduleCtx(), badCron); status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for @every, got %v", err)
		}

		badZone := scheduleFor(agent, "bad-zone", true)
		badZone.Spec.TimeZone = "Not/AZone"
		if _, err := tc.schedules.Create(scheduleCtx(), badZone); status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for a bad zone, got %v", err)
		}
	})

	t.Run("rejects a duplicate org+slug", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "dup-agent")
		createTestSchedule(t, tc, agent, "dup-schedule", true)

		_, err := tc.schedules.Create(scheduleCtx(), scheduleFor(agent, "dup-schedule", true))
		if status.Code(err) != codes.AlreadyExists {
			t.Fatalf("expected ALREADY_EXISTS, got %s (%v)", status.Code(err), err)
		}
	})
}

func TestScheduleUpdate(t *testing.T) {
	t.Run("mutable fields change; slug and status survive", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "update-agent")
		created := createTestSchedule(t, tc, agent, "update-me", true)

		updated := proto.Clone(created).(*schedulev1.Schedule)
		updated.Spec.Cron = "30 18 * * MON-FRI"
		updated.Spec.TimeZone = "UTC"
		updated.Spec.Enabled = false
		updated.GetSpec().GetAgent().Message = "Updated reminder prompt."

		result, err := tc.schedules.Update(scheduleCtx(), updated)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if result.GetSpec().GetCron() != "30 18 * * MON-FRI" || result.GetSpec().GetEnabled() {
			t.Errorf("spec should be replaced wholesale, got %v", result.GetSpec())
		}
		if result.GetMetadata().GetSlug() != created.GetMetadata().GetSlug() {
			t.Errorf("slug must be immutable across update")
		}
	})

	t.Run("re-validates cron on update", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "update-cron-agent")
		created := createTestSchedule(t, tc, agent, "update-cron", true)

		updated := proto.Clone(created).(*schedulev1.Schedule)
		updated.Spec.Cron = "CRON_TZ=UTC 0 9 * * *"

		_, err := tc.schedules.Update(scheduleCtx(), updated)
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected INVALID_ARGUMENT for a prefixed cron on update, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("agent_ref is immutable", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "pinned-agent")
		other := createTestAgent(t, tc, "other-agent")
		created := createTestSchedule(t, tc, agent, "pinned-schedule", true)

		updated := proto.Clone(created).(*schedulev1.Schedule)
		updated.GetSpec().GetAgent().AgentRef.Slug = other.GetMetadata().GetSlug()

		_, err := tc.schedules.Update(scheduleCtx(), updated)
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION, got %s (%v)", status.Code(err), err)
		}
		want := fmt.Sprintf(refImmutableMessage, "test-org", agent.GetMetadata().GetSlug())
		if !strings.Contains(err.Error(), want) {
			t.Errorf("expected the ref-immutable message naming the pinned agent, got: %v", err)
		}
	})
}

// TestScheduleApply_PreservesStatusVerbatim is the regression test behind
// DD-009's status-preservation pinned behavior: DD-008 D7's auto-pause
// records on STATUS precisely so the platform never writes spec — if a
// routine manifest apply could reset consecutive_failures or clear
// paused_reason, the safety mechanism would be defeated by the most
// ordinary action a user takes. The cloud edition's canonical update
// pipeline carries the same guarantee.
func TestScheduleApply_PreservesStatusVerbatim(t *testing.T) {
	tc := newTestControllers(t)
	agent := createTestAgent(t, tc, "streak-agent")
	created := createTestSchedule(t, tc, agent, "streak-schedule", true)

	// Simulate the scheduling runtime (slice 2): populate the firing
	// observations directly in the store, as the tick and auto-pause will.
	stored := proto.Clone(created).(*schedulev1.Schedule)
	stored.Status.ConsecutiveFailures = 5
	stored.Status.PausedReason = "5 consecutive failed runs (missing agent)"
	stored.Status.LastExecutionId = "aex_01TESTEXECUTION"
	stored.Status.LastFireAt = timestamppb.New(timestamppb.Now().AsTime())
	if err := tc.store.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("failed to seed platform-written status: %v", err)
	}

	// A routine manifest apply: same org+slug, a changed spec, NO status.
	manifest := scheduleFor(agent, "streak-schedule", true)
	manifest.Metadata.Name = "streak-schedule"
	manifest.Spec.Cron = "0 10 * * *"

	applied, err := tc.schedules.Apply(scheduleCtx(), manifest)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}

	if applied.GetSpec().GetCron() != "0 10 * * *" {
		t.Errorf("apply should update the spec, got cron %q", applied.GetSpec().GetCron())
	}
	if applied.GetStatus().GetConsecutiveFailures() != 5 {
		t.Errorf("apply must preserve consecutive_failures verbatim; got %d — a manifest apply just reset the auto-pause streak",
			applied.GetStatus().GetConsecutiveFailures())
	}
	if applied.GetStatus().GetPausedReason() != "5 consecutive failed runs (missing agent)" {
		t.Errorf("apply must preserve paused_reason verbatim; got %q — a manifest apply just un-paused an auto-paused schedule",
			applied.GetStatus().GetPausedReason())
	}
	if applied.GetStatus().GetLastExecutionId() != "aex_01TESTEXECUTION" {
		t.Errorf("apply must preserve last_execution_id verbatim; got %q",
			applied.GetStatus().GetLastExecutionId())
	}
	if applied.GetStatus().GetLastFireAt() == nil {
		t.Errorf("apply must preserve last_fire_at verbatim; got nil")
	}
}

func TestScheduleResume(t *testing.T) {
	t.Run("clears the platform pause and the failure streak, preserving the rest of status", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "resume-agent")
		created := createTestSchedule(t, tc, agent, "resume-schedule", true)

		// Simulate the tracking runtime: a platform-paused schedule with
		// firing observations resume must NOT disturb.
		stored := proto.Clone(created).(*schedulev1.Schedule)
		stored.Status.ConsecutiveFailures = 5
		stored.Status.PausedReason = "Paused after 5 consecutive failed runs."
		stored.Status.LastExecutionId = "aex_01TESTEXECUTION"
		stored.Status.LastFireAt = timestamppb.New(timestamppb.Now().AsTime())
		if err := tc.store.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
			t.Fatalf("failed to seed platform-written status: %v", err)
		}

		resumed, err := tc.schedules.Resume(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Resume failed: %v", err)
		}

		if resumed.GetStatus().GetPausedReason() != "" {
			t.Errorf("resume must clear paused_reason, got %q", resumed.GetStatus().GetPausedReason())
		}
		if resumed.GetStatus().GetConsecutiveFailures() != 0 {
			t.Errorf("resume must reset consecutive_failures — leaving the streak at 5 would re-pause on the next failure; got %d",
				resumed.GetStatus().GetConsecutiveFailures())
		}
		if resumed.GetStatus().GetLastExecutionId() != "aex_01TESTEXECUTION" {
			t.Errorf("resume must preserve last_execution_id verbatim; got %q",
				resumed.GetStatus().GetLastExecutionId())
		}
		if resumed.GetStatus().GetLastFireAt() == nil {
			t.Errorf("resume must preserve last_fire_at verbatim; got nil")
		}

		// The clear is durable, not just a response-shaping artifact.
		reloaded := &schedulev1.Schedule{}
		if err := tc.store.GetResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, created.GetMetadata().GetId(), reloaded); err != nil {
			t.Fatalf("failed to reload schedule: %v", err)
		}
		if reloaded.GetStatus().GetPausedReason() != "" || reloaded.GetStatus().GetConsecutiveFailures() != 0 {
			t.Errorf("resume must persist the cleared latch; stored paused_reason=%q consecutive_failures=%d",
				reloaded.GetStatus().GetPausedReason(), reloaded.GetStatus().GetConsecutiveFailures())
		}
	})

	t.Run("is an idempotent no-op on an unpaused schedule — no write, no audit bump", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "resume-noop-agent")
		created := createTestSchedule(t, tc, agent, "resume-noop-schedule", true)

		resumed, err := tc.schedules.Resume(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Resume of an unpaused schedule must succeed, got: %v", err)
		}
		if !proto.Equal(resumed.GetStatus(), created.GetStatus()) {
			t.Errorf("no-op resume must leave status byte-identical (no audit bump);\n created: %v\n resumed: %v",
				created.GetStatus(), resumed.GetStatus())
		}
	})

	t.Run("clears a failure streak even before the pause threshold", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "resume-streak-agent")
		created := createTestSchedule(t, tc, agent, "resume-streak-schedule", true)

		stored := proto.Clone(created).(*schedulev1.Schedule)
		stored.Status.ConsecutiveFailures = 3
		if err := tc.store.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
			t.Fatalf("failed to seed failure streak: %v", err)
		}

		resumed, err := tc.schedules.Resume(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Resume failed: %v", err)
		}
		if resumed.GetStatus().GetConsecutiveFailures() != 0 {
			t.Errorf("resume must reset a pre-threshold streak (the owner fixed the agent and wants a clean slate); got %d",
				resumed.GetStatus().GetConsecutiveFailures())
		}
	})

	t.Run("missing schedule answers NotFound", func(t *testing.T) {
		tc := newTestControllers(t)

		_, err := tc.schedules.Resume(scheduleCtx(),
			&schedulev1.ScheduleId{Value: "sch_01DOESNOTEXIST0000000000000"})
		if status.Code(err) != codes.NotFound {
			t.Errorf("resume of a missing schedule must be NotFound, got %v (%v)", status.Code(err), err)
		}
	})
}

func TestScheduleApply_CreatesWhenAbsent(t *testing.T) {
	tc := newTestControllers(t)
	agent := createTestAgent(t, tc, "apply-create-agent")

	applied, err := tc.schedules.Apply(scheduleCtx(), scheduleFor(agent, "applied-schedule", true))
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
	if !strings.HasPrefix(applied.GetMetadata().GetId(), "sch_") {
		t.Errorf("apply-as-create should mint a sch_ id, got %s", applied.GetMetadata().GetId())
	}
}

func TestScheduleQueries(t *testing.T) {
	t.Run("get, getByReference, and delete round-trip", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "query-agent")
		created := createTestSchedule(t, tc, agent, "query-schedule", true)

		got, err := tc.schedules.Get(scheduleCtx(), &schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if got.GetMetadata().GetId() != created.GetMetadata().GetId() {
			t.Errorf("Get returned the wrong schedule")
		}

		byRef, err := tc.schedules.GetByReference(scheduleCtx(), &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_schedule,
			Org:  "test-org",
			Slug: "query-schedule",
		})
		if err != nil {
			t.Fatalf("GetByReference failed: %v", err)
		}
		if byRef.GetMetadata().GetId() != created.GetMetadata().GetId() {
			t.Errorf("GetByReference returned the wrong schedule")
		}

		deleted, err := tc.schedules.Delete(scheduleCtx(), &schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}
		if deleted.GetMetadata().GetId() != created.GetMetadata().GetId() {
			t.Errorf("Delete should return the deleted schedule")
		}
		if _, err := tc.schedules.Get(scheduleCtx(), &schedulev1.ScheduleId{Value: created.GetMetadata().GetId()}); status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND after delete, got %v", err)
		}
	})

	t.Run("getByAgent filters by target and org scope", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "gba-agent")
		other := createTestAgent(t, tc, "gba-other-agent")
		createTestSchedule(t, tc, agent, "gba-one", true)
		createTestSchedule(t, tc, agent, "gba-two", false)
		createTestSchedule(t, tc, other, "gba-other", true)

		list, err := tc.schedules.GetByAgent(scheduleCtx(), &schedulev1.GetSchedulesByAgentRequest{
			AgentId: agent.GetMetadata().GetId(),
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 2 {
			t.Errorf("expected 2 schedules for the agent, got %d", list.GetTotalCount())
		}

		scoped, err := tc.schedules.GetByAgent(scheduleCtx(), &schedulev1.GetSchedulesByAgentRequest{
			AgentId: agent.GetMetadata().GetId(),
			Org:     "unrelated-org",
		})
		if err != nil {
			t.Fatalf("GetByAgent with org scope failed: %v", err)
		}
		if scoped.GetTotalCount() != 0 {
			t.Errorf("an unrelated org scope must exclude all rows, got %d", scoped.GetTotalCount())
		}

		// A nonexistent agent yields an empty list, not an error: "no
		// schedules" is the useful answer either way.
		missing, err := tc.schedules.GetByAgent(scheduleCtx(), &schedulev1.GetSchedulesByAgentRequest{
			AgentId: "agt_doesnotexist",
		})
		if err != nil {
			t.Fatalf("GetByAgent for a missing agent failed: %v", err)
		}
		if missing.GetTotalCount() != 0 {
			t.Errorf("expected an empty list for a missing agent, got %d", missing.GetTotalCount())
		}
	})

	t.Run("list filters by org and labels", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "list-agent")
		labeled := scheduleFor(agent, "list-labeled", true)
		labeled.Metadata.Labels = map[string]string{"team": "ops"}
		if _, err := tc.schedules.Create(scheduleCtx(), labeled); err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		createTestSchedule(t, tc, agent, "list-plain", true)

		all, err := tc.schedules.List(scheduleCtx(), &schedulev1.ListSchedulesRequest{Org: "test-org"})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}
		if all.GetTotalCount() != 2 {
			t.Errorf("expected 2 schedules in org, got %d", all.GetTotalCount())
		}

		filtered, err := tc.schedules.List(scheduleCtx(), &schedulev1.ListSchedulesRequest{
			Org:    "test-org",
			Labels: map[string]string{"team": "ops"},
		})
		if err != nil {
			t.Fatalf("List with labels failed: %v", err)
		}
		if filtered.GetTotalCount() != 1 {
			t.Errorf("expected 1 labeled schedule, got %d", filtered.GetTotalCount())
		}

		otherOrg, err := tc.schedules.List(scheduleCtx(), &schedulev1.ListSchedulesRequest{Org: "another-org"})
		if err != nil {
			t.Fatalf("List for another org failed: %v", err)
		}
		if otherOrg.GetTotalCount() != 0 {
			t.Errorf("expected no schedules in another org, got %d", otherOrg.GetTotalCount())
		}
	})
}
