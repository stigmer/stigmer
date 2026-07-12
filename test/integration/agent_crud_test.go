//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAgent_ApplyGetDelete(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	instanceQuery := agentinstancev1.NewAgentInstanceQueryControllerClient(grpcConn)

	instructions := "You are a test agent for CRUD verification. Respond briefly."
	description := "Agent CRUD integration test"

	agent, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-crud-apply",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: instructions,
			Description:  description,
		},
	})
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up agent: %v", err)
		}
	})

	agentID := agent.GetMetadata().GetId()

	assert.Equal(t, "agentic.stigmer.ai/v1", agent.GetApiVersion(), "api_version")
	assert.Equal(t, "Agent", agent.GetKind(), "kind")
	assert.NotEmpty(t, agentID, "server must assign an ID")
	assert.NotEmpty(t, agent.GetMetadata().GetSlug(), "server must derive a slug from name")
	assert.Equal(t, "test-org", agent.GetMetadata().GetOrg(), "org")
	assert.Equal(t, instructions, agent.GetSpec().GetInstructions(), "instructions round-trip")
	assert.Equal(t, description, agent.GetSpec().GetDescription(), "description round-trip")

	defaultInstanceID := agent.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, defaultInstanceID, "create must auto-provision a default AgentInstance")

	instance, err := instanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: defaultInstanceID})
	require.NoError(t, err, "default instance should be queryable")
	assert.Equal(t, agentID, instance.GetSpec().GetAgentId(), "instance should reference parent agent")

	t.Logf("agent created: id=%s, slug=%s, default_instance=%s",
		agentID, agent.GetMetadata().GetSlug(), defaultInstanceID)

	got, err := clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err, "get by ID should succeed")
	assert.Equal(t, agentID, got.GetMetadata().GetId(), "get returns same agent")
	assert.Equal(t, instructions, got.GetSpec().GetInstructions(), "get returns correct instructions")
	assert.Equal(t, defaultInstanceID, got.GetStatus().GetDefaultInstanceId(), "get returns default_instance_id")

	deleted, err := clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err, "delete should succeed")
	assert.Equal(t, agentID, deleted.GetMetadata().GetId(), "delete returns pre-delete snapshot")

	_, err = clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agentID})
	require.Error(t, err, "get after delete should fail")
	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	// A just-deleted id must be NOT_FOUND. Existence is resolved before authorization,
	// so a missing resource is never masked as PERMISSION_DENIED (stigmer/stigmer#224).
	require.Equalf(t, codes.NotFound, st.Code(),
		"expected NOT_FOUND after delete, got %s: %s", st.Code(), st.Message())
}

func TestAgent_Apply_Upsert_ByOrgAndSlug(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	baseAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-upsert-agent",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "Original instructions for the upsert test agent.",
			Description:  "First apply",
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, baseAgent)
	require.NoError(t, err, "first apply should create")
	id1 := created.GetMetadata().GetId()
	slug1 := created.GetMetadata().GetSlug()
	defaultInstance1 := created.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, id1)
	require.NotEmpty(t, defaultInstance1)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: id1})
	})

	updatedInstructions := "Updated instructions after upsert via apply."
	baseAgent.Spec.Instructions = updatedInstructions
	baseAgent.Spec.Description = "Second apply"

	updated, err := clients.AgentCommand.Apply(ctx, baseAgent)
	require.NoError(t, err, "second apply should update (upsert by org+slug)")

	assert.Equal(t, id1, updated.GetMetadata().GetId(),
		"apply upsert must return same ID — resolution is by (org, slug), not by ID")
	assert.Equal(t, slug1, updated.GetMetadata().GetSlug(), "slug must be preserved on update")
	assert.Equal(t, updatedInstructions, updated.GetSpec().GetInstructions(),
		"instructions should reflect the second apply")
	assert.Equal(t, defaultInstance1, updated.GetStatus().GetDefaultInstanceId(),
		"default_instance_id must be preserved on update — not re-created")

	t.Logf("upsert verified: id=%s, slug=%s, default_instance_id preserved=%s",
		id1, slug1, defaultInstance1)
}

func TestAgent_Apply_PreservesStatusOnUpdate(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-status-preserve",
		"You are a test agent. Respond briefly to verify status preservation.")

	originalInstanceID := agent.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, originalInstanceID)

	updated, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: agent.GetMetadata().GetName(),
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "Updated instructions for status preservation test.",
			Description:  "Updated description",
		},
	})
	require.NoError(t, err, "apply update should succeed")

	assert.Equal(t, originalInstanceID, updated.GetStatus().GetDefaultInstanceId(),
		"status.default_instance_id must be preserved across updates — status is server-managed")

	t.Logf("status preserved: default_instance_id=%s", originalInstanceID)
}

func TestAgent_Apply_InstructionsTooShort(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-short-instr",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "short",
		},
	})
	require.Error(t, err, "instructions < 10 chars should be rejected by protovalidate")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"expected INVALID_ARGUMENT for instructions too short, got %s: %s", st.Code(), st.Message())

	t.Logf("instructions validation enforced: %s", st.Message())
}

func TestAgent_Apply_WithMcpServerRefs(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	// Create an MCP server resource to reference.
	// Use a mock HTTP URL since we only need the resource to exist, not to connect.
	mcpSrv := harness.CreateHttpMcpServer(t, ctx, clients, "http://localhost:0/not-a-real-server")
	mcpSlug := mcpSrv.GetMetadata().GetSlug()

	agent, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-mcp-ref-norm",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent with MCP server references.",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Slug: mcpSlug,
						Kind: 44, // mcp_server
						// org intentionally empty — server should normalize it
					},
				},
			},
		},
	})
	require.NoError(t, err, "apply with MCP server ref should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	})

	got, err := clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
	require.NoError(t, err, "get agent should succeed")

	usages := got.GetSpec().GetMcpServerUsages()
	require.Len(t, usages, 1, "should have exactly 1 MCP server usage")
	assert.Equal(t, "test-org", usages[0].GetMcpServerRef().GetOrg(),
		"server should normalize empty org to metadata.org (NormalizeApiResourceReferencesStepV2)")
	assert.Equal(t, mcpSlug, usages[0].GetMcpServerRef().GetSlug(), "slug preserved")

	t.Logf("MCP ref normalized: org=%s, slug=%s",
		usages[0].GetMcpServerRef().GetOrg(), usages[0].GetMcpServerRef().GetSlug())
}

func TestAgent_GetByReference(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-getbyref",
		"You are a test agent for GetByReference verification.")

	slug := agent.GetMetadata().GetSlug()
	agentID := agent.GetMetadata().GetId()

	got, err := clients.AgentQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  "test-org",
		Slug: slug,
		Kind: 40, // agent
	})
	require.NoError(t, err, "getByReference with valid org+slug should succeed")
	assert.Equal(t, agentID, got.GetMetadata().GetId(),
		"getByReference should return the same agent as get-by-ID")

	t.Logf("getByReference resolved: slug=%s → id=%s", slug, agentID)

	_, err = clients.AgentQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  "test-org",
		Slug: "nonexistent-slug-12345",
		Kind: 40,
	})
	require.Error(t, err, "getByReference with non-existent slug should fail")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"non-existent slug should return NOT_FOUND, got %s", st.Code())

	_, err = clients.AgentQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  "",
		Slug: slug,
		Kind: 40,
	})
	require.Error(t, err, "getByReference with empty org should fail")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"empty org should return INVALID_ARGUMENT, got %s", st.Code())
}

func TestAgent_UpdateVisibility(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-visibility",
		"You are a test agent for visibility toggle verification.")

	agentID := agent.GetMetadata().GetId()

	updated, err := clients.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
		ResourceId: agentID,
		Visibility: apiresource.ApiResourceVisibility_visibility_public,
	})
	require.NoError(t, err, "updateVisibility to public should succeed")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_public,
		updated.GetMetadata().GetVisibility(), "visibility should be public after update")

	got, err := clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err)
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_public,
		got.GetMetadata().GetVisibility(), "get should reflect public visibility")

	reverted, err := clients.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
		ResourceId: agentID,
		Visibility: apiresource.ApiResourceVisibility_visibility_private,
	})
	require.NoError(t, err, "updateVisibility back to private should succeed")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_private,
		reverted.GetMetadata().GetVisibility(), "visibility should be private after revert")

	t.Logf("visibility toggled: id=%s, public→private", agentID)
}

func TestAgent_Delete_NonCascading(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	instanceQuery := agentinstancev1.NewAgentInstanceQueryControllerClient(grpcConn)

	agent, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-noncascade-delete",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent for non-cascading delete verification.",
		},
	})
	require.NoError(t, err)

	agentID := agent.GetMetadata().GetId()
	instanceID := agent.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, instanceID)

	_, err = instanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: instanceID})
	require.NoError(t, err, "default instance should exist before delete")

	_, err = clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err, "delete agent should succeed")

	_, err = clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: agentID})
	require.Error(t, err, "agent should be gone after delete")

	// The default instance should survive — agent delete is non-cascading.
	// Only the agent document + FGA tuples are removed.
	orphanedInstance, err := instanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: instanceID})
	if err != nil {
		st, ok := status.FromError(err)
		if ok && st.Code() == codes.PermissionDenied {
			t.Logf("instance get returned PERMISSION_DENIED — FGA tuples for parent agent were cleaned up, "+
				"but instance document still exists (FGA denied access). This is expected when FGA is active. id=%s", instanceID)
		} else {
			require.NoError(t, err, "default instance should survive agent delete (non-cascading)")
		}
	} else {
		assert.Equal(t, instanceID, orphanedInstance.GetMetadata().GetId(),
			"orphaned instance should still be queryable")
		t.Logf("non-cascading delete verified: agent=%s deleted, instance=%s survives",
			agentID, instanceID)
	}

	// Clean up the orphaned instance.
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		instanceCmd := agentinstancev1.NewAgentInstanceCommandControllerClient(grpcConn)
		instanceCmd.Delete(cleanCtx, &agentinstancev1.AgentInstanceId{Value: instanceID})
	})
}

func TestAgent_Delete_Nonexistent(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: "nonexistent-agent-id-12345"})
	require.Error(t, err, "deleting non-existent agent should fail")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	// FGA may deny access before the service checks existence.
	require.True(t,
		st.Code() == codes.NotFound || st.Code() == codes.PermissionDenied,
		"expected NOT_FOUND or PERMISSION_DENIED, got %s: %s", st.Code(), st.Message())

	t.Logf("delete nonexistent correctly rejected: code=%s, message=%s", st.Code(), st.Message())
}
