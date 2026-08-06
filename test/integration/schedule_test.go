//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
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
				Agent: &agentexecv1.AgentInvocation{
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

// TestSchedule_Resume verifies the resume command over the wire (T04
// slice 2b-ii pair A, DD-013 D-D): resuming an unpaused schedule is an
// idempotent no-op that answers the full resource with status untouched,
// and a missing schedule answers NOT_FOUND (the handler loads before
// authorizing, #224). The full pause→resume loop — a genuinely paused
// schedule going live again — is proven with the tracking runtime (pair
// B), which is what makes a platform pause producible over the wire in
// the first place.
func TestSchedule_Resume(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-resume",
		"You are a helpful agent for schedule resume tests.")

	created, err := clients.ScheduleCommand.Apply(ctx,
		scheduleManifestFor(org, "resume-wire-schedule", agent.GetMetadata().GetSlug()))
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = clients.ScheduleCommand.Delete(cleanupCtx,
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
	})

	t.Run("resuming an unpaused schedule is an idempotent no-op", func(t *testing.T) {
		resumed, err := clients.ScheduleCommand.Resume(ctx,
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		require.NoError(t, err, "resume of an unpaused schedule must succeed")
		assert.Equal(t, created.GetMetadata().GetId(), resumed.GetMetadata().GetId())
		assert.Empty(t, resumed.GetStatus().GetPausedReason())
		assert.Zero(t, resumed.GetStatus().GetConsecutiveFailures())
	})

	t.Run("resuming a missing schedule answers NOT_FOUND", func(t *testing.T) {
		_, err := clients.ScheduleCommand.Resume(ctx,
			&schedulev1.ScheduleId{Value: "sch_01DOESNOTEXIST0000000000000"})
		require.Error(t, err)
		assert.Equal(t, codes.NotFound, status.Code(err),
			"a missing schedule must answer NOT_FOUND, never PERMISSION_DENIED — the handler loads before authorizing")
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

// TestSchedule_RunLifecycle verifies the run (T04 slice 2b-i, project
// DD-012): a triggered fire creates a real AgentExecution through the
// standard pipeline as the schedule caller — deterministic name (the
// idempotency key), schedule-id labels on the execution AND its fresh
// session, the pinned session subject, the unattended stamp, and the
// status.last_execution_id reverse pointer. The cross-repo pinned strings
// asserted here (`stigmer.ai/schedule-id`, `Scheduled run: `, the name
// format) are the mirror guards DD-008 D10 requires.
//
// The completion tier (the run reaching a terminal phase — the proof that
// the runner's blueprint reads pass the schedule arm of the sandbox
// bypass, DD-012 D-D layer 2) needs a live runner + LLM key and rides the
// native prerequisites gate like every completion test in this suite.
func TestSchedule_RunLifecycle(t *testing.T) {
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

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-run",
		"You are a helpful agent for schedule run tests. Respond briefly.")

	created, err := clients.ScheduleCommand.Apply(ctx,
		scheduleManifestFor(org, "run-schedule", agent.GetMetadata().GetSlug()))
	require.NoError(t, err)
	scheduleID := created.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		_, _ = clients.ScheduleCommand.Delete(cleanupCtx,
			&schedulev1.ScheduleId{Value: scheduleID})
	})

	// ── 1. A triggered fire creates the run and stamps the pointer ──
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))

	var fetched *schedulev1.Schedule
	require.Eventually(t, func() bool {
		got, getErr := clients.ScheduleQuery.Get(ctx,
			&schedulev1.ScheduleId{Value: scheduleID})
		if getErr != nil || got.GetStatus().GetLastExecutionId() == "" {
			return false
		}
		fetched = got
		return true
	}, 60*time.Second, 500*time.Millisecond,
		"the tick must create the execution and stamp last_execution_id")

	executionID := fetched.GetStatus().GetLastExecutionId()
	execution, err := clients.AgentExecutionQuery.Get(ctx,
		&agentexecv1.AgentExecutionId{Value: executionID})
	require.NoError(t, err, "the stamped execution must be readable")

	// ── 2. The execution carries the run contract ──
	// The deterministic name = the idempotency key (DD-012 D-A), derived
	// from the schedule id and the NOMINAL fire time — recomputed here
	// from status.last_fire_at, byte-for-byte (the cross-repo pin).
	require.NotNil(t, fetched.GetStatus().GetLastFireAt())
	expectedName := strings.ToLower(strings.ReplaceAll(scheduleID, "_", "-")) +
		"-" + fetched.GetStatus().GetLastFireAt().AsTime().UTC().Format("20060102t150405z")
	assert.Equal(t, expectedName, execution.GetMetadata().GetName(),
		"the execution name is the (schedule, nominal fire time) idempotency key")
	assert.Equal(t, scheduleID,
		execution.GetMetadata().GetLabels()["stigmer.ai/schedule-id"],
		"the audit label links the run back to its schedule")
	assert.Equal(t, org, execution.GetMetadata().GetOrg(),
		"the scope step forces the schedule's org")
	assert.Equal(t, agentexecv1.ApprovalMode_APPROVAL_MODE_UNATTENDED,
		execution.GetSpec().GetExecutionConfig().GetApprovalMode(),
		"a scheduled run is unattended — gated tools must skip-and-adapt (DD-014)")
	assert.Contains(t, execution.GetSpec().GetMessage(),
		"Send fee reminders to members whose dues fall in the next 3 days.",
		"the owner's configured prompt rides the message")
	assert.Contains(t, execution.GetSpec().GetMessage(), "(Scheduled fire time: ",
		"the fire-context line supplies the date the runner never injects (DD-008 D5)")
	assert.Contains(t, execution.GetSpec().GetMessage(), "Asia/Kolkata",
		"the fire time renders in the schedule's own zone")

	// ── 3. The fresh session carries the subject, label, and link ──
	sessionID := execution.GetSpec().GetSessionId()
	require.NotEmpty(t, sessionID, "each tick runs on a fresh auto-created session")
	session, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err,
		"the session must be readable — its schedule link grants can_view to the "+
			"schedule's viewers (DD-012 D-E)")
	assert.Equal(t, "Scheduled run: run-schedule", session.GetSpec().GetSubject(),
		"the pinned subject titles the session and opts out of LLM titling")
	assert.Equal(t, scheduleID,
		session.GetMetadata().GetLabels()["stigmer.ai/schedule-id"])

	// ── 4. A second trigger CAN mint a second run (a new nominal time is
	// a new fire — idempotency is per fire, never per schedule) ──
	// The nominal time is second-granular (it IS the idempotency key), so
	// a trigger landing in the SAME wall second as the first fire would
	// dedupe into the first execution and the pointer would never advance.
	// Wait out the first fire's second before triggering again.
	firstFireSecond := fetched.GetStatus().GetLastFireAt().AsTime().Truncate(time.Second)
	if wait := time.Until(firstFireSecond.Add(1200 * time.Millisecond)); wait > 0 {
		time.Sleep(wait)
	}
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))
	require.Eventually(t, func() bool {
		got, getErr := clients.ScheduleQuery.Get(ctx,
			&schedulev1.ScheduleId{Value: scheduleID})
		return getErr == nil && got.GetStatus().GetLastExecutionId() != "" &&
			got.GetStatus().GetLastExecutionId() != executionID
	}, 60*time.Second, 500*time.Millisecond,
		"a later fire must create its own execution and advance the pointer")

	// ── 5. Completion: the runner's blueprint reads pass the schedule arm
	// of the sandbox bypass (DD-012 D-D layer 2). "Created" alone would
	// not catch a mid-run denial, which dies AFTER billing and sandbox
	// side effects — hence the terminal-phase assertion.
	t.Run("run completes end to end", func(t *testing.T) {
		harness.RequireNativePrereqs(t, testHarness)

		waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
		result, err := waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
		require.NoError(t, err, "the scheduled run must reach a terminal phase")
		require.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
			result.GetStatus().GetPhase(),
			"a permission denial in the runner's blueprint reads would fail here — "+
				"the exact hole DD-012 D-D exists to close; error: %s",
			result.GetStatus().GetError())
	})
}

// TestSchedule_RunTracking verifies the failure streak, the auto-pause,
// and resume clearing it, end to end over the wire (T04 slice 2b-ii,
// DD-013) — WITHOUT an LLM: a dangling agent_ref makes every fire a
// deterministic TARGET_MISSING failure (DD-008 D9: agent deletion never
// cascades to schedules; the streak is how the dangle surfaces), so this
// tier runs in offline CI. The harness lowers the pause threshold to 2
// (service.go) so the pause lands in two fires instead of five.
//
// The pause copy, the cleared next_fire_at, the artifact's paused state,
// the skipped-while-paused tick, and resume re-arming the clock are all
// asserted against the LIVE system — the cloud fat JAR plus the same
// Temporal dev server it schedules on.
func TestSchedule_RunTracking(t *testing.T) {
	require.NotNil(t, grpcConn)
	require.NotNil(t, testHarness.Temporal, "Temporal dev server must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	temporalClient, err := testHarness.Temporal.Client()
	require.NoError(t, err, "should connect to Temporal")
	t.Cleanup(temporalClient.Close)
	inspector := harness.NewScheduleInspector(temporalClient)

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	agent := harness.CreateAgent(t, ctx, clients, "test-schedule-tracking",
		"You are a helpful agent for schedule tracking tests.")

	created, err := clients.ScheduleCommand.Apply(ctx,
		scheduleManifestFor(org, "tracking-schedule", agent.GetMetadata().GetSlug()))
	require.NoError(t, err)
	scheduleID := created.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		_, _ = clients.ScheduleCommand.Delete(cleanupCtx,
			&schedulev1.ScheduleId{Value: scheduleID})
	})

	// Dangle the target: from here every fire fails deterministically.
	_, err = clients.AgentCommand.Delete(ctx,
		&agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.NoError(t, err, "agent deletion must not cascade to the schedule")

	getSchedule := func() *schedulev1.Schedule {
		got, getErr := clients.ScheduleQuery.Get(ctx,
			&schedulev1.ScheduleId{Value: scheduleID})
		require.NoError(t, getErr)
		return got
	}

	// ── 1. The first failed fire advances the streak, no pause ──
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))
	require.Eventually(t, func() bool {
		return getSchedule().GetStatus().GetConsecutiveFailures() == 1
	}, 60*time.Second, 500*time.Millisecond,
		"a TARGET_MISSING fire must advance consecutive_failures to 1")
	assert.Empty(t, getSchedule().GetStatus().GetPausedReason(),
		"one failure must not pause (threshold is 2 in this suite)")

	// ── 2. The threshold fire pauses: teaching copy, cleared next fire,
	// paused artifact ──
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))
	var paused *schedulev1.Schedule
	require.Eventually(t, func() bool {
		got := getSchedule()
		if got.GetStatus().GetPausedReason() == "" {
			return false
		}
		paused = got
		return true
	}, 60*time.Second, 500*time.Millisecond,
		"the second failure must cross the threshold and pause the schedule")

	assert.Equal(t, int32(2), paused.GetStatus().GetConsecutiveFailures())
	assert.Contains(t, paused.GetStatus().GetPausedReason(),
		"Paused after 2 consecutive failed runs.",
		"the pause copy teaches the mechanism")
	assert.Contains(t, paused.GetStatus().GetPausedReason(), "not found",
		"the pause copy names the last failure — the dangling agent")
	assert.Nil(t, paused.GetStatus().GetNextFireAt(),
		"a paused schedule has no next fire (the field's contract)")

	require.Eventually(t, func() bool {
		desc, descErr := inspector.DescribeArtifact(ctx, scheduleID)
		return descErr == nil && desc.Schedule.State.Paused
	}, 30*time.Second, 500*time.Millisecond,
		"the pause must reach the Temporal artifact (immediate re-sync, sweep as backstop)")

	// ── 3. A paused schedule's ticks skip: the streak is frozen ──
	require.NoError(t, inspector.TriggerArtifact(ctx, scheduleID))
	time.Sleep(3 * time.Second) // give a wrongly-firing tick time to do damage
	assert.Equal(t, int32(2), getSchedule().GetStatus().GetConsecutiveFailures(),
		"ticks on a paused schedule must no-op — the streak stays frozen")

	// ── 4. Resume clears the latch, resets the streak, re-arms the clock ──
	resumed, err := clients.ScheduleCommand.Resume(ctx,
		&schedulev1.ScheduleId{Value: scheduleID})
	require.NoError(t, err)
	assert.Empty(t, resumed.GetStatus().GetPausedReason(),
		"resume clears the platform's latch")
	assert.Zero(t, resumed.GetStatus().GetConsecutiveFailures(),
		"resume resets the streak — 2 strikes would re-pause on the next failure")
	assert.NotNil(t, resumed.GetStatus().GetNextFireAt(),
		"resume re-arms the clock and answers with the next fire")

	require.Eventually(t, func() bool {
		desc, descErr := inspector.DescribeArtifact(ctx, scheduleID)
		return descErr == nil && !desc.Schedule.State.Paused
	}, 30*time.Second, 500*time.Millisecond,
		"the resumed artifact must be unpaused")
}
