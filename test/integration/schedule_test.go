//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	enumspb "go.temporal.io/api/enums/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers the Schedule resource's wire contract against the cloud
// backend (this suite boots the stigmer-service fat JAR — see
// suite_test.go): the declarative apply loop, the read surface (get,
// getByReference, getByAgent), the update immutability rules, the cron
// grammar refusals, and delete (T04 slice 1) — plus the clock (T04 slice
// 2a): every write converges a Temporal Schedule artifact on the SAME
// Temporal dev server this harness runs, so TestSchedule_ClockLifecycle
// asserts the artifact directly through the Temporal ScheduleClient (the
// first use of that API in this repo) and proves a fire lands on status.
// The edition-specific pipelines are pinned in each edition's own suites
// (schedule/controller tests in Go; ScheduleSpecRulesTest, the schedule
// temporal package tests, and the repo contract suite in Java). The OSS
// Go server's own clock is T04 slice 3.

// scheduleManifestFor builds a Schedule manifest as a YAML apply would
// send it: relative agent_ref (empty org — the server normalizes it).
func scheduleManifestFor(org, name, agentSlug string) *schedulev1.Schedule {
	return &schedulev1.Schedule{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Schedule",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &schedulev1.ScheduleSpec{
			Cron:     "0 9 * * *",
			TimeZone: "Asia/Kolkata",
			Enabled:  true,
			Target: &schedulev1.ScheduleSpec_Agent{
				Agent: &schedulev1.AgentTarget{
					AgentRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_agent,
						Slug: agentSlug,
					},
					Message: "Send fee reminders to members whose dues fall in the next 3 days.",
				},
			},
		},
	}
}

// TestSchedule_DeclarativeLifecycle verifies the apply→read→re-apply→
// delete loop: apply creates with the sch prefix and a normalized
// agent_ref, the read surface resolves the schedule by id, reference, and
// agent, re-applying a fetched manifest updates in place, and delete
// removes it without touching the referenced agent.
func TestSchedule_DeclarativeLifecycle(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-lifecycle",
		"You are a helpful agent for schedule integration tests.")

	created, err := clients.ScheduleCommand.Apply(ctx,
		scheduleManifestFor(org, "lifecycle-schedule", agent.GetMetadata().GetSlug()))
	require.NoError(t, err, "apply should create the schedule")
	assert.Contains(t, created.GetMetadata().GetId(), "sch",
		"the id must carry the sch prefix")
	assert.Equal(t, org, created.GetSpec().GetAgent().GetAgentRef().GetOrg(),
		"the relative agent_ref must be normalized to the schedule's org")
	assert.Zero(t, created.GetStatus().GetConsecutiveFailures(),
		"status is platform-owned and starts empty")

	fetched, err := clients.ScheduleQuery.Get(ctx,
		&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, "0 9 * * *", fetched.GetSpec().GetCron())

	byRef, err := clients.ScheduleQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_schedule,
		Org:  org,
		Slug: created.GetMetadata().GetSlug(),
	})
	require.NoError(t, err)
	assert.Equal(t, created.GetMetadata().GetId(), byRef.GetMetadata().GetId())

	byAgent, err := clients.ScheduleQuery.GetByAgent(ctx, &schedulev1.GetSchedulesByAgentRequest{
		AgentId: agent.GetMetadata().GetId(),
	})
	require.NoError(t, err)
	require.NotZero(t, byAgent.GetTotalCount(),
		"getByAgent must resolve the agent's schedules")
	found := false
	for _, item := range byAgent.GetItems() {
		if item.GetMetadata().GetId() == created.GetMetadata().GetId() {
			found = true
		}
	}
	assert.True(t, found, "getByAgent must include the created schedule")

	// The declarative loop: re-apply the fetched manifest with a changed
	// cron. Must update in place, never duplicate.
	fetched.Spec.Cron = "30 18 * * MON-FRI"
	reapplied, err := clients.ScheduleCommand.Apply(ctx, fetched)
	require.NoError(t, err, "re-applying a fetched manifest must succeed")
	assert.Equal(t, created.GetMetadata().GetId(), reapplied.GetMetadata().GetId(),
		"re-apply must update in place, never duplicate")
	assert.Equal(t, "30 18 * * MON-FRI", reapplied.GetSpec().GetCron())

	deleted, err := clients.ScheduleCommand.Delete(ctx,
		&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, created.GetMetadata().GetId(), deleted.GetMetadata().GetId())

	_, err = clients.ScheduleQuery.Get(ctx,
		&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
	require.Error(t, err, "the schedule must be gone after delete")

	// The referenced agent is untouched (no cascade in either direction).
	_, err = clients.AgentQuery.Get(ctx,
		&agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	assert.NoError(t, err, "deleting a schedule must not touch the referenced agent")
}

// TestSchedule_ContractRefusals verifies the write-path refusals over the
// wire: the DD-009 C-4 cron grammar (a timezone prefix would store a spec
// that fails when the clock lands), the same-org invariant, the missing
// agent, and the update immutability rules.
func TestSchedule_ContractRefusals(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-refusals",
		"You are a helpful agent for schedule refusal tests.")
	agentSlug := agent.GetMetadata().GetSlug()

	t.Run("cron grammar is enforced at apply", func(t *testing.T) {
		prefixed := scheduleManifestFor(org, "refusal-cron-prefix", agentSlug)
		prefixed.Spec.Cron = "CRON_TZ=UTC 0 9 * * *"
		_, err := clients.ScheduleCommand.Apply(ctx, prefixed)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
		assert.Contains(t, err.Error(), "spec.time_zone is the single timezone authority")

		interval := scheduleManifestFor(org, "refusal-cron-interval", agentSlug)
		interval.Spec.Cron = "@every 30s"
		_, err = clients.ScheduleCommand.Apply(ctx, interval)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))

		seconds := scheduleManifestFor(org, "refusal-cron-seconds", agentSlug)
		seconds.Spec.Cron = "* * * * * * *"
		_, err = clients.ScheduleCommand.Apply(ctx, seconds)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("timezone must be a resolvable IANA name", func(t *testing.T) {
		badZone := scheduleManifestFor(org, "refusal-zone", agentSlug)
		badZone.Spec.TimeZone = "Not/AZone"
		_, err := clients.ScheduleCommand.Apply(ctx, badZone)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("cross-org agent_ref is refused before probing slugs", func(t *testing.T) {
		crossOrg := scheduleManifestFor(org, "refusal-cross-org", agentSlug)
		crossOrg.Spec.GetAgent().AgentRef.Org = "some-foreign-org"
		_, err := clients.ScheduleCommand.Apply(ctx, crossOrg)
		require.Error(t, err)
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	})

	t.Run("nonexistent agent is refused with NOT_FOUND", func(t *testing.T) {
		ghost := scheduleManifestFor(org, "refusal-ghost-agent", "no-such-agent")
		_, err := clients.ScheduleCommand.Apply(ctx, ghost)
		require.Error(t, err)
		assert.Equal(t, codes.NotFound, status.Code(err))
	})

	t.Run("agent_ref is immutable on update", func(t *testing.T) {
		other := harness.CreateAgent(t, ctx, clients, "test-schedule-repoint-target",
			"You are the agent a repoint must NOT reach.")

		created, err := clients.ScheduleCommand.Apply(ctx,
			scheduleManifestFor(org, "refusal-repoint", agentSlug))
		require.NoError(t, err)

		created.Spec.GetAgent().AgentRef.Slug = other.GetMetadata().GetSlug()
		_, err = clients.ScheduleCommand.Update(ctx, created)
		require.Error(t, err,
			"repointing would bypass the create-time can_edit consent on the referenced agent")
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
		assert.Contains(t, err.Error(), "spec.agent.agent_ref is immutable")
	})

	t.Run("the interval floor is enforced from Temporal's own fire times", func(t *testing.T) {
		// */2 passes the lexical grammar (slice 1) but fires every two
		// minutes — below the 5-minute platform floor, which the probe
		// step computes from Temporal's projected fire times (DD-010 D-C:
		// the platform parses no cron).
		fast := scheduleManifestFor(org, "refusal-floor", agentSlug)
		fast.Spec.Cron = "*/2 * * * *"
		_, err := clients.ScheduleCommand.Apply(ctx, fast)
		require.Error(t, err)
		assert.Equal(t, codes.FailedPrecondition, status.Code(err))
		assert.Contains(t, err.Error(), "minimum interval")

		// Refusal happens BEFORE the first write: no row exists.
		_, err = clients.ScheduleQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_schedule,
			Org:  org,
			Slug: "refusal-floor",
		})
		require.Error(t, err, "a floor refusal must persist nothing")
	})

	t.Run("a lexically valid cron Temporal rejects is refused with Temporal's verdict", func(t *testing.T) {
		// Minute 99 passes the lexical grammar (digits, five fields) but
		// is out of range — the probe relays Temporal's own parser verdict
		// as INVALID_ARGUMENT instead of letting the spec detonate at
		// arming time (the C-4 gap, closed by DD-010 D-A).
		bad := scheduleManifestFor(org, "refusal-temporal-verdict", agentSlug)
		bad.Spec.Cron = "99 * * * *"
		_, err := clients.ScheduleCommand.Apply(ctx, bad)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})
}

// TestSchedule_ClockLifecycle verifies the clock end to end (T04 slice
// 2a): every schedule write converges a Temporal Schedule artifact with
// the complete desired state (asserted directly through the Temporal
// ScheduleClient against the same dev server the service under test
// uses), a triggered fire lands on status through the tick workflow, the
// enabled flag round-trips to the artifact's paused state, and delete
// tears the artifact down.
func TestSchedule_ClockLifecycle(t *testing.T) {
	require.NotNil(t, grpcConn)
	require.NotNil(t, testHarness.Temporal, "Temporal dev server must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	temporalClient, err := testHarness.Temporal.Client()
	require.NoError(t, err, "should connect to Temporal")
	t.Cleanup(temporalClient.Close)
	inspector := harness.NewScheduleInspector(temporalClient)

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-clock",
		"You are a helpful agent for schedule clock tests.")

	created, err := clients.ScheduleCommand.Apply(ctx,
		scheduleManifestFor(org, "clock-schedule", agent.GetMetadata().GetSlug()))
	require.NoError(t, err)
	scheduleID := created.GetMetadata().GetId()

	// ── 1. The artifact is armed with the complete desired state ──
	desc, err := inspector.DescribeArtifact(ctx, scheduleID)
	require.NoError(t, err, "apply must create the Temporal artifact")
	assert.Equal(t, "cron=0 9 * * * tz=Asia/Kolkata", desc.Schedule.State.Note,
		"the state note is the drift fingerprint (cron does not round-trip)")
	assert.False(t, desc.Schedule.State.Paused, "an enabled schedule must not be paused")
	assert.Equal(t, "Asia/Kolkata", desc.Schedule.Spec.TimeZoneName)
	assert.Equal(t, enumspb.SCHEDULE_OVERLAP_POLICY_SKIP, desc.Schedule.Policy.Overlap,
		"SKIP must be explicit — a tracked tick makes it real (DD-008 D6)")
	assert.False(t, desc.Schedule.Policy.PauseOnFailure,
		"Temporal must never pause behind the platform's back (DD-010 D-D)")

	// The apply response mirrors the armed state — no stale read needed.
	assert.NotNil(t, created.GetStatus().GetNextFireAt(),
		"an armed schedule answers with its next fire time")

	// ── 2. A fire lands on status through the tick workflow ──
	// trigger() replaces waiting on a cron minute boundary and exercises
	// the same mechanism (nominal-time search attribute + id suffix).
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))

	var lastFire time.Time
	require.Eventually(t, func() bool {
		fetched, getErr := clients.ScheduleQuery.Get(ctx,
			&schedulev1.ScheduleId{Value: scheduleID})
		if getErr != nil || fetched.GetStatus().GetLastFireAt() == nil {
			return false
		}
		lastFire = fetched.GetStatus().GetLastFireAt().AsTime()
		return true
	}, 30*time.Second, 500*time.Millisecond,
		"the tick must record last_fire_at after a triggered fire")

	assert.Zero(t, lastFire.Nanosecond(),
		"last_fire_at is the NOMINAL fire time — whole seconds by construction")
	assert.WithinDuration(t, time.Now(), lastFire, 2*time.Minute,
		"a triggered fire's nominal time is the trigger moment")

	// ── 3. Disabling pauses the artifact and clears next_fire_at ──
	fetched, err := clients.ScheduleQuery.Get(ctx, &schedulev1.ScheduleId{Value: scheduleID})
	require.NoError(t, err)
	fetched.Spec.Enabled = false
	disabled, err := clients.ScheduleCommand.Apply(ctx, fetched)
	require.NoError(t, err)
	assert.Nil(t, disabled.GetStatus().GetNextFireAt(),
		"next_fire_at is absent while disabled — the field's contract")

	desc, err = inspector.DescribeArtifact(ctx, scheduleID)
	require.NoError(t, err)
	assert.True(t, desc.Schedule.State.Paused, "disabling must pause the artifact")

	// ── 4. Re-enabling with a new cron updates the artifact in place ──
	fetched, err = clients.ScheduleQuery.Get(ctx, &schedulev1.ScheduleId{Value: scheduleID})
	require.NoError(t, err)
	fetched.Spec.Enabled = true
	fetched.Spec.Cron = "30 18 * * *"
	reenabled, err := clients.ScheduleCommand.Apply(ctx, fetched)
	require.NoError(t, err)
	assert.NotNil(t, reenabled.GetStatus().GetNextFireAt(),
		"re-enabling re-arms and answers with the next fire time")

	desc, err = inspector.DescribeArtifact(ctx, scheduleID)
	require.NoError(t, err)
	assert.Equal(t, "cron=30 18 * * * tz=Asia/Kolkata", desc.Schedule.State.Note)
	assert.False(t, desc.Schedule.State.Paused)

	// ── 5. Delete tears the artifact down ──
	_, err = clients.ScheduleCommand.Delete(ctx, &schedulev1.ScheduleId{Value: scheduleID})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		exists, existsErr := inspector.ArtifactExists(ctx, scheduleID)
		return existsErr == nil && !exists
	}, 10*time.Second, 250*time.Millisecond,
		"delete must tear the Temporal artifact down")

	// ── 6. The write path leaves no probe residue behind ──
	leftovers, err := inspector.ListProbeLeftovers(ctx)
	require.NoError(t, err)
	assert.Empty(t, leftovers,
		"every fire-time probe must be deleted within its request")
}
