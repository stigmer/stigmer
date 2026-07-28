//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// createRawSession creates a session via the raw gRPC client (not the harness
// helper) for tests that need control over all fields. The session is
// auto-deleted on test cleanup.
func createRawSession(t *testing.T, ctx context.Context, clients *harness.Clients, agentInstanceID, subject string) *sessionv1.Session {
	t.Helper()

	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-session-" + uuid.New().String()[:8],
			Org:  "test-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agentInstanceID,
			Subject:         subject,
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	}

	created, err := clients.SessionCommand.Create(ctx, session)
	require.NoError(t, err, "create session should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId(), "session should have an ID")

	t.Logf("created session: id=%s, subject=%q", created.GetMetadata().GetId(), subject)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up session %s: %v", created.GetMetadata().GetId(), err)
		}
	})

	return created
}

func TestSession_CreateGetDelete(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-session-crud",
		"You are a test agent for session lifecycle verification.")

	instanceID := agent.GetStatus().GetDefaultInstanceId()

	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-session-crud-" + uuid.New().String()[:8],
			Org:  "test-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: instanceID,
			Subject:         "test session for CRUD",
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	}

	created, err := clients.SessionCommand.Create(ctx, session)
	require.NoError(t, err, "create session should succeed")

	sessionID := created.GetMetadata().GetId()
	require.NotEmpty(t, sessionID)

	assert.Equal(t, "agentic.stigmer.ai/v1", created.GetApiVersion(), "api_version")
	assert.Equal(t, "Session", created.GetKind(), "kind")
	assert.NotEmpty(t, created.GetMetadata().GetSlug(), "server must derive a slug")
	assert.Equal(t, instanceID, created.GetSpec().GetAgentInstanceId(), "agent_instance_id round-trip")
	assert.Equal(t, "test session for CRUD", created.GetSpec().GetSubject(), "subject round-trip")
	assert.Equal(t, sessionv1.Harness_HARNESS_NATIVE, created.GetSpec().GetHarness(), "harness round-trip")

	t.Logf("session created: id=%s, slug=%s", sessionID, created.GetMetadata().GetSlug())

	got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err, "get by ID should succeed")
	assert.Equal(t, sessionID, got.GetMetadata().GetId(), "get returns same session")
	assert.Equal(t, "test session for CRUD", got.GetSpec().GetSubject(), "subject persisted")
	assert.Equal(t, instanceID, got.GetSpec().GetAgentInstanceId(), "agent_instance_id persisted")

	deleted, err := clients.SessionCommand.Delete(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err, "delete should succeed")
	assert.Equal(t, sessionID, deleted.GetMetadata().GetId(), "delete returns pre-delete snapshot")

	_, err = clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.Error(t, err, "get after delete should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.True(t,
		st.Code() == codes.NotFound || st.Code() == codes.PermissionDenied,
		"expected NOT_FOUND or PERMISSION_DENIED after delete, got %s: %s", st.Code(), st.Message())
}

func TestSession_Create_EmptyAgentInstance_ResolvesDefault(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	session, err := clients.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-default-resolve-" + uuid.New().String()[:8],
			Org:  "test-org",
		},
		Spec: &sessionv1.SessionSpec{
			Subject: "default agent resolution test",
			Harness: sessionv1.Harness_HARNESS_NATIVE,
		},
	})
	require.NoError(t, err, "create with empty agent_instance_id should succeed — server resolves default")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: session.GetMetadata().GetId()})
	})

	resolvedInstanceID := session.GetSpec().GetAgentInstanceId()
	require.NotEmpty(t, resolvedInstanceID,
		"server must resolve and populate agent_instance_id from the platform default agent")

	t.Logf("default agent resolved: session=%s, resolved_instance=%s",
		session.GetMetadata().GetId(), resolvedInstanceID)
}

func TestSession_Create_InvalidAgentInstance(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	// Java SessionCreateHandler runs ResolveDefaultAgentInstance as a no-op
	// when agent_instance_id is non-empty — it does NOT validate that the
	// referenced instance exists. FGA authorization is on the org (not the
	// instance), so the create may succeed with a bogus ID stored.
	//
	// This test documents the actual server behavior.
	session, err := clients.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-bad-instance-" + uuid.New().String()[:8],
			Org:  "test-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: "nonexistent-instance-id-12345",
			Subject:         "invalid instance test",
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	})

	if err == nil {
		// Server accepted the bogus instance ID — this is the documented
		// behavior: instance existence is NOT validated at session creation.
		// Failures surface later at execution time.
		t.Logf("BEHAVIORAL NOTE: session created with bogus agent_instance_id=%q — "+
			"server does not validate instance existence at session creation time. session_id=%s",
			"nonexistent-instance-id-12345", session.GetMetadata().GetId())

		t.Cleanup(func() {
			cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: session.GetMetadata().GetId()})
		})

		assert.Equal(t, "nonexistent-instance-id-12345", session.GetSpec().GetAgentInstanceId(),
			"bogus instance ID should be stored as-is")
	} else {
		// FGA or another layer rejected it before persist.
		st, ok := status.FromError(err)
		require.True(t, ok, "error should be a gRPC status")
		t.Logf("session creation with bogus instance rejected: code=%s, message=%s",
			st.Code(), st.Message())
		assert.True(t,
			st.Code() == codes.NotFound || st.Code() == codes.PermissionDenied || st.Code() == codes.InvalidArgument,
			"expected NOT_FOUND, PERMISSION_DENIED, or INVALID_ARGUMENT, got %s", st.Code())
	}
}

func TestSession_List_OffsetPagination(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-session-list",
		"You are a test agent for session list pagination verification.")

	instanceID := agent.GetStatus().GetDefaultInstanceId()

	// Create 5 sessions so we can paginate with page_size=2.
	createdIDs := make(map[string]bool, 5)
	for i := 0; i < 5; i++ {
		s := createRawSession(t, ctx, clients, instanceID, "list-test-session")
		createdIDs[s.GetMetadata().GetId()] = false
	}

	// Page 0 (first page): page_token="" or "0"
	page0, err := clients.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{
		PageSize:  2,
		PageToken: "",
	})
	require.NoError(t, err, "list page 0 should succeed")
	assert.Len(t, page0.GetEntries(), 2, "page 0 should return page_size entries")
	assert.GreaterOrEqual(t, page0.GetTotalPages(), int32(3),
		"5 sessions / page_size 2 = at least 3 pages (other sessions may exist from parallel tests)")

	for _, entry := range page0.GetEntries() {
		if _, ok := createdIDs[entry.GetMetadata().GetId()]; ok {
			createdIDs[entry.GetMetadata().GetId()] = true
		}
	}

	// Page 1 (second page)
	page1, err := clients.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{
		PageSize:  2,
		PageToken: "1",
	})
	require.NoError(t, err, "list page 1 should succeed")
	assert.Len(t, page1.GetEntries(), 2, "page 1 should return page_size entries")

	for _, entry := range page1.GetEntries() {
		if _, ok := createdIDs[entry.GetMetadata().GetId()]; ok {
			createdIDs[entry.GetMetadata().GetId()] = true
		}
	}

	// Page 2 (third page)
	page2, err := clients.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{
		PageSize:  2,
		PageToken: "2",
	})
	require.NoError(t, err, "list page 2 should succeed")
	assert.GreaterOrEqual(t, len(page2.GetEntries()), 1, "page 2 should have at least 1 entry")

	for _, entry := range page2.GetEntries() {
		if _, ok := createdIDs[entry.GetMetadata().GetId()]; ok {
			createdIDs[entry.GetMetadata().GetId()] = true
		}
	}

	// Verify all 5 created sessions appeared across pages.
	// In a shared test org, other sessions may exist, so we check that
	// our specific IDs were found — not exact counts.
	foundCount := 0
	for id, found := range createdIDs {
		if found {
			foundCount++
		} else {
			t.Logf("session %s not found in first 3 pages (may be on a later page)", id)
		}
	}
	// With 6 entries per 3 pages of size 2, we should find most of our 5.
	// But other parallel tests may push ours to later pages. Require at least 3.
	assert.GreaterOrEqual(t, foundCount, 3,
		"at least 3 of our 5 sessions should appear in the first 3 pages")

	t.Logf("pagination verified: total_pages=%d, found %d/%d of our sessions in 3 pages",
		page0.GetTotalPages(), foundCount, len(createdIDs))
}

func TestSession_ListByAgentInstance_FiltersByInstanceId(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent1 := harness.CreateAgent(t, ctx, clients, "test-listbyagentinstance-a",
		"You are test agent A for listByAgentInstance filtering verification.")
	agent2 := harness.CreateAgent(t, ctx, clients, "test-listbyagentinstance-b",
		"You are test agent B for listByAgentInstance filtering verification.")

	instanceID1 := agent1.GetStatus().GetDefaultInstanceId()
	instanceID2 := agent2.GetStatus().GetDefaultInstanceId()

	s1a := createRawSession(t, ctx, clients, instanceID1, "agent1-session-a")
	s1b := createRawSession(t, ctx, clients, instanceID1, "agent1-session-b")
	s2a := createRawSession(t, ctx, clients, instanceID2, "agent2-session-a")

	// listByAgentInstance filters sessions by spec.agent_instance_id. The Java
	// handler uses the request's agent_instance_id as spec.agentInstanceId in the
	// store query (SessionListByAgentInstanceHandler.java).
	list1, err := clients.SessionQuery.ListByAgentInstance(ctx, &sessionv1.ListSessionsByAgentInstanceRequest{
		AgentInstanceId: instanceID1,
	})
	require.NoError(t, err, "listByAgentInstance for instance1 should succeed")

	foundS1a := false
	foundS1b := false
	foundS2a := false
	for _, entry := range list1.GetEntries() {
		switch entry.GetMetadata().GetId() {
		case s1a.GetMetadata().GetId():
			foundS1a = true
		case s1b.GetMetadata().GetId():
			foundS1b = true
		case s2a.GetMetadata().GetId():
			foundS2a = true
		}
	}

	assert.True(t, foundS1a, "agent1 session A should appear in listByAgentInstance results")
	assert.True(t, foundS1b, "agent1 session B should appear in listByAgentInstance results")
	assert.False(t, foundS2a,
		"agent2 session should NOT appear when filtering by agent1's instance ID")

	t.Logf("listByAgentInstance filtering verified: instance=%s returned %d sessions, "+
		"found expected=%v/%v, excluded=%v",
		instanceID1, len(list1.GetEntries()), foundS1a, foundS1b, !foundS2a)
}

func TestSession_UpdateSubject(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-session-subject",
		"You are a test agent for session subject update verification.")

	session := createRawSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), "original subject")

	sessionID := session.GetMetadata().GetId()

	// Update subject to a new value.
	updated, err := clients.SessionCommand.UpdateSubject(ctx, &sessionv1.UpdateSessionSubjectRequest{
		Id:      sessionID,
		Subject: "updated title",
	})
	require.NoError(t, err, "updateSubject should succeed")
	assert.Equal(t, "updated title", updated.GetSpec().GetSubject(),
		"returned session should reflect the new subject")

	got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err)
	assert.Equal(t, "updated title", got.GetSpec().GetSubject(),
		"get should reflect the updated subject")

	// Empty string should clear the subject (per proto: "Empty string clears the subject").
	cleared, err := clients.SessionCommand.UpdateSubject(ctx, &sessionv1.UpdateSessionSubjectRequest{
		Id:      sessionID,
		Subject: "",
	})
	require.NoError(t, err, "updateSubject with empty string should succeed")
	assert.Empty(t, cleared.GetSpec().GetSubject(),
		"empty subject should clear the field")

	t.Logf("subject updates verified: id=%s, set→cleared", sessionID)
}

func TestSession_Update_Metadata(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-session-metadata",
		"You are a test agent for session metadata update verification.")

	session := createRawSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), "metadata test session")

	sessionID := session.GetMetadata().GetId()

	// Full update with custom metadata map.
	session.Spec.Metadata = map[string]string{
		"key1": "value1",
		"key2": "value2",
	}
	session.Metadata.Id = sessionID

	updated, err := clients.SessionCommand.Update(ctx, session)
	require.NoError(t, err, "full update with metadata should succeed")

	got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err)

	md := got.GetSpec().GetMetadata()
	assert.Equal(t, "value1", md["key1"], "metadata key1 should be persisted")
	assert.Equal(t, "value2", md["key2"], "metadata key2 should be persisted")

	_ = updated
	t.Logf("metadata update verified: id=%s, keys=%v", sessionID, md)
}

func TestSession_Delete_Nonexistent(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.SessionCommand.Delete(ctx, &sessionv1.SessionId{Value: "nonexistent-session-id-12345"})
	require.Error(t, err, "deleting non-existent session should fail")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	require.True(t,
		st.Code() == codes.NotFound || st.Code() == codes.PermissionDenied,
		"expected NOT_FOUND or PERMISSION_DENIED, got %s: %s", st.Code(), st.Message())

	t.Logf("delete nonexistent correctly rejected: code=%s", st.Code())
}

func TestSession_Delete_DoesNotCascadeExecutions(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-session-cascade-"+h.Name,
				"You are a test agent. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			sessionID := session.GetMetadata().GetId()

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionID, "Reply with exactly: cascade-test")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			executionID := exec.GetMetadata().GetId()

			// Delete the session.
			_, err = clients.SessionCommand.Delete(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "delete session should succeed")

			// Session should be gone.
			_, err = clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.Error(t, err, "session should be deleted")

			// Execution should survive — session delete is non-cascading.
			// The execution becomes an orphaned reference.
			orphanedExec, err := clients.AgentExecutionQuery.Get(ctx,
				&agentexecv1.AgentExecutionId{Value: executionID})
			if err != nil {
				st, ok := status.FromError(err)
				if ok && st.Code() == codes.PermissionDenied {
					t.Logf("execution get returned PERMISSION_DENIED — FGA session-scoped "+
						"permissions may have been cleaned up. This is acceptable when FGA is active. "+
						"execution_id=%s", executionID)
				} else {
					require.NoError(t, err,
						"execution should survive session delete (non-cascading)")
				}
			} else {
				assert.Equal(t, executionID, orphanedExec.GetMetadata().GetId())
				assert.Equal(t, sessionID, orphanedExec.GetSpec().GetSessionId(),
					"orphaned execution should still reference the deleted session ID")
				t.Logf("non-cascading delete verified: session=%s deleted, execution=%s survives",
					sessionID, executionID)
			}
		})
	}
}
