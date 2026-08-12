package handler

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	activityv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/activity/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// The store-driven tests below exercise the full read path against a real
// SQLite store (the setupTestController precedent): rows are written exactly
// as the persist steps write them, and the handler reads them back through
// store.ListResources — no mocks between the handler and the storage engine.

func setupHandler(t *testing.T) (*Handler, store.Store) {
	t.Helper()
	st, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err, "failed to create temp sqlite store")
	t.Cleanup(func() { _ = st.Close() })
	return NewHandler(st), st
}

// auditAt builds the audit shape SetAuditFieldsForCreate stamps, with
// statusAudit.updatedAt at the given instant — the recents sort key.
func auditAt(updated time.Time) *apiresource.ApiResourceAudit {
	stamp := timestamppb.New(updated)
	return &apiresource.ApiResourceAudit{
		SpecAudit:   &apiresource.ApiResourceAuditInfo{CreatedAt: stamp, UpdatedAt: stamp},
		StatusAudit: &apiresource.ApiResourceAuditInfo{CreatedAt: stamp, UpdatedAt: stamp},
	}
}

func saveSession(t *testing.T, st store.Store, id, subject string, labels map[string]string, audit *apiresource.ApiResourceAudit) {
	t.Helper()
	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id, Org: "stigmer", Labels: labels},
		Spec:       &sessionv1.SessionSpec{AgentInstanceId: "agi_test", Subject: subject},
		Status:     &apiresource.ApiResourceAuditStatus{Audit: audit},
	}
	require.NoError(t, st.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_session, id, session))
}

func saveExecution(t *testing.T, st store.Store, id, name string, phase workflowexecutionv1.ExecutionPhase, audit *apiresource.ApiResourceAudit) {
	t.Helper()
	execution := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: name, Org: "stigmer"},
		Status:     &workflowexecutionv1.WorkflowExecutionStatus{Phase: phase, Audit: audit},
	}
	require.NoError(t, st.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_workflow_execution, id, execution))
}

func listEntries(t *testing.T, h *Handler, pageSize int32) []*activityv1.RecentActivityEntry {
	t.Helper()
	resp, err := h.ListRecentActivity(context.Background(), &activityv1.ListRecentActivityRequest{PageSize: pageSize})
	require.NoError(t, err)
	return resp.GetEntries()
}

func entryIDs(entries []*activityv1.RecentActivityEntry) []string {
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.GetId()
	}
	return ids
}

func TestListRecentActivity_MergesKindsNewestFirst(t *testing.T) {
	h, st := setupHandler(t)
	base := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)

	saveSession(t, st, "ses_old", "Plan the migration", nil, auditAt(base))
	saveExecution(t, st, "wfx_mid", "nightly-sync", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, auditAt(base.Add(1*time.Hour)))
	saveSession(t, st, "ses_new", "Review the PR", nil, auditAt(base.Add(2*time.Hour)))
	saveExecution(t, st, "wfx_newest", "deploy", workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, auditAt(base.Add(3*time.Hour)))

	entries := listEntries(t, h, 0)

	assert.Equal(t, []string{"wfx_newest", "ses_new", "wfx_mid", "ses_old"}, entryIDs(entries),
		"entries must interleave both kinds sorted by statusAudit.updatedAt descending")
}

func TestListRecentActivity_ProjectionFields(t *testing.T) {
	h, st := setupHandler(t)
	when := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)

	saveSession(t, st, "ses_1", "Plan the migration", nil, auditAt(when))
	saveExecution(t, st, "wfx_1", "nightly-sync", workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, auditAt(when.Add(time.Hour)))

	entries := listEntries(t, h, 0)
	require.Len(t, entries, 2)

	execution, session := entries[0], entries[1]

	assert.Equal(t, "workflow_execution", execution.GetType())
	assert.Equal(t, "nightly-sync", execution.GetSubject())
	assert.Equal(t, "failed", execution.GetStatus(), "execution status must be the phase display token")
	assert.Equal(t, when.Add(time.Hour).Unix(), execution.GetUpdatedAt().GetSeconds())

	assert.Equal(t, "session", session.GetType())
	assert.Equal(t, "Plan the migration", session.GetSubject())
	assert.Empty(t, session.GetStatus(), "sessions carry no status token")
	assert.Equal(t, when.Unix(), session.GetUpdatedAt().GetSeconds())
}

func TestListRecentActivity_SubjectFallbacks(t *testing.T) {
	h, st := setupHandler(t)
	base := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)

	saveSession(t, st, "ses_empty", "", nil, auditAt(base.Add(3*time.Hour)))
	saveSession(t, st, "ses_sentinel", "Auto-created session", nil, auditAt(base.Add(2*time.Hour)))
	saveExecution(t, st, "wfx_unnamed", "", workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING, auditAt(base.Add(1*time.Hour)))

	entries := listEntries(t, h, 0)
	require.Len(t, entries, 3)

	assert.Equal(t, "Untitled session", entries[0].GetSubject(), "empty subject falls back")
	assert.Equal(t, "Untitled session", entries[1].GetSubject(), "the auto-created sentinel falls back")
	assert.Equal(t, "Untitled execution", entries[2].GetSubject(), "unnamed execution falls back")
}

func TestListRecentActivity_ExcludesRuntimeOriginSessions(t *testing.T) {
	h, st := setupHandler(t)
	when := auditAt(time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC))

	for i, key := range runtimeOriginLabels {
		saveSession(t, st, fmt.Sprintf("ses_runtime_%d", i), "runtime", map[string]string{key: "some-id"}, when)
	}
	saveSession(t, st, "ses_console", "console", nil, when)
	saveSession(t, st, "ses_labeled", "labeled", map[string]string{"team": "billing"}, when)

	entries := listEntries(t, h, 0)

	assert.ElementsMatch(t, []string{"ses_console", "ses_labeled"}, entryIDs(entries),
		"every runtime-origin label must exclude its session; unrelated labels must not")
}

func TestListRecentActivity_PageSize(t *testing.T) {
	h, st := setupHandler(t)
	base := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	// 35 sessions, newest last — enough to cross the default page size of 30.
	for i := 0; i < 35; i++ {
		saveSession(t, st, fmt.Sprintf("ses_%02d", i), "s", nil, auditAt(base.Add(time.Duration(i)*time.Minute)))
	}

	t.Run("explicit_page_size_trims", func(t *testing.T) {
		entries := listEntries(t, h, 2)
		assert.Equal(t, []string{"ses_34", "ses_33"}, entryIDs(entries))
	})

	t.Run("zero_defaults_to_30", func(t *testing.T) {
		entries := listEntries(t, h, 0)
		require.Len(t, entries, 30)
		assert.Equal(t, "ses_34", entries[0].GetId(), "page must contain the newest rows")
		assert.Equal(t, "ses_05", entries[29].GetId())
	})

	t.Run("negative_defaults_to_30", func(t *testing.T) {
		assert.Len(t, listEntries(t, h, -5), 30)
	})

	t.Run("oversized_request_returns_all_rows_under_cap", func(t *testing.T) {
		assert.Len(t, listEntries(t, h, 500), 35, "requests above the cap clamp to 100, which exceeds the 35 stored rows")
	})
}

func TestListRecentActivity_TimestampFallbackAndTies(t *testing.T) {
	h, st := setupHandler(t)
	base := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)

	t.Run("falls_back_to_spec_created_at", func(t *testing.T) {
		// A row whose statusAudit was never stamped (external tooling / older
		// build) sorts by specAudit.createdAt instead of sinking to epoch.
		saveSession(t, st, "ses_no_status_audit", "legacy", nil, &apiresource.ApiResourceAudit{
			SpecAudit: &apiresource.ApiResourceAuditInfo{CreatedAt: timestamppb.New(base.Add(2 * time.Hour))},
		})
		saveSession(t, st, "ses_stamped", "current", nil, auditAt(base.Add(1*time.Hour)))

		entries := listEntries(t, h, 0)
		assert.Equal(t, []string{"ses_no_status_audit", "ses_stamped"}, entryIDs(entries))
	})

	t.Run("equal_timestamps_keep_sessions_before_executions", func(t *testing.T) {
		tie := auditAt(base.Add(3 * time.Hour))
		saveSession(t, st, "ses_tie", "tie", nil, tie)
		saveExecution(t, st, "wfx_tie", "tie", workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, tie)

		entries := listEntries(t, h, 2)
		assert.Equal(t, []string{"ses_tie", "wfx_tie"}, entryIDs(entries),
			"the sort is stable over the sessions-then-executions load order (cloud tie-break parity)")
	})
}

func TestListRecentActivity_EmptyStore(t *testing.T) {
	h, _ := setupHandler(t)
	entries := listEntries(t, h, 0)
	assert.Empty(t, entries, "an empty store answers an empty page, not an error")
}

func TestNormalizePageSize(t *testing.T) {
	tests := []struct {
		name      string
		requested int32
		want      int
	}{
		{"zero_defaults", 0, defaultPageSize},
		{"negative_defaults", -1, defaultPageSize},
		{"in_range_passes_through", 7, 7},
		{"at_cap_passes_through", 100, 100},
		{"above_cap_clamps", 101, maxPageSize},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, normalizePageSize(tt.requested))
		})
	}
}

func TestResolvePhase(t *testing.T) {
	tests := []struct {
		phase workflowexecutionv1.ExecutionPhase
		want  string
	}{
		{workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING, "pending"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "running"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "completed"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "failed"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, "cancelled"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, "terminated"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED, "paused"},
		{workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED, "unknown"},
		{workflowexecutionv1.ExecutionPhase(99), "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			assert.Equal(t, tt.want, resolvePhase(tt.phase))
		})
	}
}

func TestTimestampAfter(t *testing.T) {
	tests := []struct {
		name string
		a, b *timestamppb.Timestamp
		want bool
	}{
		{"later_seconds", &timestamppb.Timestamp{Seconds: 2}, &timestamppb.Timestamp{Seconds: 1}, true},
		{"earlier_seconds", &timestamppb.Timestamp{Seconds: 1}, &timestamppb.Timestamp{Seconds: 2}, false},
		{"same_seconds_later_nanos", &timestamppb.Timestamp{Seconds: 1, Nanos: 2}, &timestamppb.Timestamp{Seconds: 1, Nanos: 1}, true},
		{"equal_is_not_after", &timestamppb.Timestamp{Seconds: 1, Nanos: 1}, &timestamppb.Timestamp{Seconds: 1, Nanos: 1}, false},
		{"nil_is_zero", nil, &timestamppb.Timestamp{Seconds: 1}, false},
		{"after_nil", &timestamppb.Timestamp{Seconds: 1}, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, timestampAfter(tt.a, tt.b))
		})
	}
}
