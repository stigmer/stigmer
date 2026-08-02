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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers the Schedule resource's wire contract against the cloud
// backend (this suite boots the stigmer-service fat JAR — see
// suite_test.go): the declarative apply loop, the read surface (get,
// getByReference, getByAgent), the update immutability rules, the cron
// grammar refusals, and delete. The edition-specific pipelines are pinned
// in each edition's own controller suites (schedule/controller tests in
// Go, ScheduleSpecRulesTest + the repo contract suite in Java); this
// asserts the shared contract over the wire (T04 slice 1). Nothing fires:
// the clock is slice 2 — this slice's contract is storage and validation.

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
}
