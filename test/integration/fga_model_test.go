//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fgaCheck calls the OpenFGA Check API and returns whether access is allowed.
// Returns false for HTTP 400 responses, which occur when a conditional tuple
// is missing required context parameters (the condition cannot be satisfied).
func fgaCheck(t *testing.T, fga *harness.OpenFGAContainer, user, relation, object string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	body := map[string]any{
		"tuple_key": map[string]string{
			"user":     user,
			"relation": relation,
			"object":   object,
		},
		"authorization_model_id": fga.ModelID,
	}
	reqBody, err := json.Marshal(body)
	require.NoError(t, err)

	url := fmt.Sprintf("%s/stores/%s/check", fga.HTTPEndpoint, fga.StoreID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	if resp.StatusCode == http.StatusBadRequest {
		return false
	}
	require.Equal(t, http.StatusOK, resp.StatusCode, "check API failed: %s", string(respBody))

	var result struct {
		Allowed bool `json:"allowed"`
	}
	require.NoError(t, json.Unmarshal(respBody, &result))
	return result.Allowed
}

// fgaCheckWithContext calls the OpenFGA Check API with additional context
// (e.g. for conditional tuples like allow_public).
func fgaCheckWithContext(t *testing.T, fga *harness.OpenFGAContainer, user, relation, object string, fgaContext map[string]any) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	body := map[string]any{
		"tuple_key": map[string]string{
			"user":     user,
			"relation": relation,
			"object":   object,
		},
		"authorization_model_id": fga.ModelID,
		"context":                fgaContext,
	}
	reqBody, err := json.Marshal(body)
	require.NoError(t, err)

	url := fmt.Sprintf("%s/stores/%s/check", fga.HTTPEndpoint, fga.StoreID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "check API failed: %s", string(respBody))

	var result struct {
		Allowed bool `json:"allowed"`
	}
	require.NoError(t, json.Unmarshal(respBody, &result))
	return result.Allowed
}

func requireFGA(t *testing.T) *harness.OpenFGAContainer {
	t.Helper()
	if testHarness == nil || testHarness.OpenFGA == nil {
		t.Skip("OpenFGA not available — skipping FGA model test")
	}
	return testHarness.OpenFGA
}

// TestFGAModel_PlatformOperatorPermissions verifies that a platform operator
// has all platform-level permissions defined in platform.fga.
func TestFGAModel_PlatformOperatorPermissions(t *testing.T) {
	fga := requireFGA(t)

	operator := "identity_account:test-identity-account-id"
	platform := "platform:stigmer"

	permissions := []string{
		"can_impersonate",
		"can_bootstrap_iam",
		"can_manage_identity_accounts",
		"can_delete_session",
		"can_update_usage",
		"can_execute_billing_ops",
		"can_grant_access",
		"can_view_access",
	}

	for _, perm := range permissions {
		t.Run(perm, func(t *testing.T) {
			assert.True(t, fgaCheck(t, fga, operator, perm, platform),
				"operator should have %s on platform", perm)
		})
	}

	// Non-operator should not have platform permissions
	nonOperator := "identity_account:random-user"
	t.Run("non_operator_denied", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, nonOperator, "can_impersonate", platform),
			"non-operator should NOT have can_impersonate")
	})
}

// TestFGAModel_OrgOwnerHierarchy verifies the role hierarchy:
// owner > admin > member > viewer
func TestFGAModel_OrgOwnerHierarchy(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	owner := "identity_account:test-identity-account-id"
	org := "organization:test-org"

	// Owner should have all org-level permissions
	ownerPerms := []string{
		"can_view", "can_edit", "can_delete",
		"can_manage_members", "can_assign_roles",
		"can_create_agent", "can_create_workflow",
		"can_create_session", "can_create_environment",
		"can_manage_billing", "can_view_billing",
	}
	for _, perm := range ownerPerms {
		t.Run("owner_"+perm, func(t *testing.T) {
			assert.True(t, fgaCheck(t, fga, owner, perm, org),
				"org owner should have %s", perm)
		})
	}

	// Add a member to the org
	member := "identity_account:member-alice"
	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: member, Relation: "member", Object: org},
	})
	require.NoError(t, err)

	// Member should have member-level permissions
	t.Run("member_can_view", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, member, "can_view", org))
	})
	t.Run("member_can_create_session", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, member, "can_create_session", org))
	})

	// Member should NOT have admin-level permissions
	t.Run("member_cannot_edit", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, member, "can_edit", org))
	})
	t.Run("member_cannot_delete", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, member, "can_delete", org))
	})

	// Stranger should have no access
	stranger := "identity_account:stranger-bob"
	t.Run("stranger_cannot_view", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, stranger, "can_view", org))
	})
}

// TestFGAModel_AgentOpenAccess verifies that agents use the "open" access
// model: all org members can view, owners can edit.
func TestFGAModel_AgentOpenAccess(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	owner := "identity_account:test-identity-account-id"
	member := "identity_account:member-alice"
	agent := "agent:test-agent-1"

	// Ensure member exists in org (may already be seeded from previous test)
	_ = fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: member, Relation: "member", Object: "organization:test-org"},
	})

	// Create agent tuples (simulates what the handler pipeline does)
	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: "organization:test-org", Relation: "organization", Object: agent},
		{User: owner, Relation: "owner", Object: agent},
	})
	require.NoError(t, err)

	// Owner can view and edit
	t.Run("owner_can_view", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_view", agent))
	})
	t.Run("owner_can_edit", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_edit", agent))
	})

	// Org member can view (open access) but not edit
	t.Run("member_can_view", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, member, "can_view", agent))
	})
	t.Run("member_cannot_edit", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, member, "can_edit", agent))
	})
}

// TestFGAModel_SessionPersonalResource verifies that sessions are personal
// resources: only the owner (and explicit grants) can view.
func TestFGAModel_SessionPersonalResource(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	owner := "identity_account:test-identity-account-id"
	member := "identity_account:member-alice"
	session := "session:private-chat-1"

	// Create session tuples
	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: "organization:test-org", Relation: "organization", Object: session},
		{User: owner, Relation: "owner", Object: session},
	})
	require.NoError(t, err)

	// Owner can view and edit their session
	t.Run("owner_can_view", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_view", session))
	})
	t.Run("owner_can_edit", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_edit", session))
	})

	// Another org member cannot view (personal resource, no admin inheritance)
	t.Run("member_cannot_view", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, member, "can_view", session))
	})

	// After explicit viewer grant, the member can view
	err = fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: member, Relation: "viewer", Object: session},
	})
	require.NoError(t, err)

	t.Run("member_can_view_after_grant", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, member, "can_view", session))
	})
	t.Run("member_still_cannot_edit", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, member, "can_edit", session))
	})
}

// TestFGAModel_AgentExecutionSessionInheritance verifies that agent execution
// permissions are inherited from the parent session.
func TestFGAModel_AgentExecutionSessionInheritance(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	owner := "identity_account:test-identity-account-id"
	viewer := "identity_account:session-viewer"
	session := "session:exec-parent"
	execution := "agent_execution:exec-1"

	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: "organization:test-org", Relation: "organization", Object: session},
		{User: owner, Relation: "owner", Object: session},
		{User: viewer, Relation: "viewer", Object: session},
		{User: session, Relation: "session", Object: execution},
	})
	require.NoError(t, err)

	// Session owner inherits execution owner
	t.Run("session_owner_can_edit_execution", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_edit", execution))
	})
	t.Run("session_owner_can_view_execution", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, owner, "can_view", execution))
	})

	// Session viewer can view but not edit execution
	t.Run("session_viewer_can_view_execution", func(t *testing.T) {
		assert.True(t, fgaCheck(t, fga, viewer, "can_view", execution))
	})
	t.Run("session_viewer_cannot_edit_execution", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, viewer, "can_edit", execution))
	})

	// Stranger cannot access execution
	stranger := "identity_account:stranger"
	t.Run("stranger_cannot_view_execution", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, stranger, "can_view", execution))
	})
}

// TestFGAModel_PublicVisibilityCondition verifies that the conditional
// allow_public wildcard grants viewer access only when context includes
// {"allow": true}.
func TestFGAModel_PublicVisibilityCondition(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	agent := "agent:public-agent-1"
	stranger := "identity_account:cross-org-user"

	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: "organization:test-org", Relation: "organization", Object: agent},
		{User: "identity_account:test-identity-account-id", Relation: "owner", Object: agent},
	})
	require.NoError(t, err)

	// Without public wildcard, stranger cannot view
	t.Run("stranger_cannot_view_private", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, stranger, "can_view", agent))
	})

	// Write the conditional public wildcard tuple
	body := map[string]any{
		"writes": map[string]any{
			"tuple_keys": []map[string]any{
				{
					"user":     "identity_account:*",
					"relation": "viewer",
					"object":   agent,
					"condition": map[string]any{
						"name":    "allow_public",
						"context": map[string]any{},
					},
				},
			},
		},
		"authorization_model_id": fga.ModelID,
	}
	reqBody, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/stores/%s/write", fga.HTTPEndpoint, fga.StoreID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, "write conditional tuple: %s", string(respBody))

	// Without context, wildcard is inactive
	t.Run("stranger_no_context_denied", func(t *testing.T) {
		assert.False(t, fgaCheck(t, fga, stranger, "can_view", agent))
	})

	// With allow=true context, wildcard resolves
	t.Run("stranger_with_allow_context_granted", func(t *testing.T) {
		assert.True(t, fgaCheckWithContext(t, fga, stranger, "can_view", agent,
			map[string]any{"allow": true}))
	})
}

// fgaListObjects calls the OpenFGA ListObjects API without evaluation context.
// Returns the list of object IDs, or an error string if the call fails.
func fgaListObjects(t *testing.T, fga *harness.OpenFGAContainer, user, relation, objectType string) ([]string, error) {
	t.Helper()
	return fgaListObjectsWithContext(t, fga, user, relation, objectType, nil)
}

// fgaListObjectsWithContext calls the OpenFGA ListObjects API with evaluation
// context (e.g. {"allow": false} to suppress conditional wildcards).
func fgaListObjectsWithContext(t *testing.T, fga *harness.OpenFGAContainer, user, relation, objectType string, fgaContext map[string]any) ([]string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	body := map[string]any{
		"user":                   user,
		"relation":               relation,
		"type":                   objectType,
		"authorization_model_id": fga.ModelID,
	}
	if fgaContext != nil {
		body["context"] = fgaContext
	}

	reqBody, err := json.Marshal(body)
	require.NoError(t, err)

	url := fmt.Sprintf("%s/stores/%s/list-objects", fga.HTTPEndpoint, fga.StoreID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ListObjects failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Objects []string `json:"objects"`
	}
	require.NoError(t, json.Unmarshal(respBody, &result))
	return result.Objects, nil
}

// TestFGAModel_ListObjectsWithConditionalTuples verifies that ListObjects
// behaves correctly when conditional wildcard tuples (allow_public) exist:
//   - Without context: fails with validation_error (missing context params)
//   - With {"allow": false}: succeeds, wildcard does not expand
//   - With {"allow": true}: succeeds, wildcard expands and public resources appear
func TestFGAModel_ListObjectsWithConditionalTuples(t *testing.T) {
	fga := requireFGA(t)
	ctx := context.Background()

	owner := "identity_account:test-identity-account-id"
	stranger := "identity_account:list-objects-stranger"
	publicAgent := "agent:list-objects-public-agent"
	privateAgent := "agent:list-objects-private-agent"

	// Set up two agents in the same org: one public, one private
	err := fga.WriteTuples(ctx, []harness.RelationshipTuple{
		{User: "organization:test-org", Relation: "organization", Object: publicAgent},
		{User: owner, Relation: "owner", Object: publicAgent},
		{User: "organization:test-org", Relation: "organization", Object: privateAgent},
		{User: owner, Relation: "owner", Object: privateAgent},
	})
	require.NoError(t, err)

	// Write conditional public wildcard for the public agent only
	writeBody := map[string]any{
		"writes": map[string]any{
			"tuple_keys": []map[string]any{
				{
					"user":     "identity_account:*",
					"relation": "viewer",
					"object":   publicAgent,
					"condition": map[string]any{
						"name":    "allow_public",
						"context": map[string]any{},
					},
				},
			},
		},
		"authorization_model_id": fga.ModelID,
	}
	reqBody, _ := json.Marshal(writeBody)
	writeURL := fmt.Sprintf("%s/stores/%s/write", fga.HTTPEndpoint, fga.StoreID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, writeURL, bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, "write conditional tuple: %s", string(body))

	// ListObjects WITHOUT context: should fail because FGA cannot evaluate
	// the allow_public condition without the required "allow" parameter.
	t.Run("no_context_returns_error", func(t *testing.T) {
		_, err := fgaListObjects(t, fga, stranger, "can_view", "agent")
		assert.Error(t, err, "ListObjects without context should fail when conditional tuples exist")
		if err != nil {
			assert.Contains(t, err.Error(), "missing context parameters",
				"error should mention missing context parameters")
		}
	})

	// ListObjects WITH {"allow": false}: should succeed but NOT include
	// the public agent (condition evaluates to false, wildcard inactive).
	t.Run("allow_false_excludes_public", func(t *testing.T) {
		objects, err := fgaListObjectsWithContext(t, fga, stranger, "can_view", "agent",
			map[string]any{"allow": false})
		require.NoError(t, err, "ListObjects with allow=false should succeed")
		assert.NotContains(t, objects, publicAgent,
			"public agent should NOT appear when allow=false")
		assert.NotContains(t, objects, privateAgent,
			"private agent should NOT appear for stranger")
	})

	// ListObjects WITH {"allow": true}: should succeed and INCLUDE the
	// public agent (condition evaluates to true, wildcard expands).
	t.Run("allow_true_includes_public", func(t *testing.T) {
		objects, err := fgaListObjectsWithContext(t, fga, stranger, "can_view", "agent",
			map[string]any{"allow": true})
		require.NoError(t, err, "ListObjects with allow=true should succeed")
		assert.Contains(t, objects, publicAgent,
			"public agent SHOULD appear when allow=true")
		assert.NotContains(t, objects, privateAgent,
			"private agent should NOT appear for stranger even with allow=true")
	})

	// ListObjects for the org owner should always see both agents
	// (org membership grants access regardless of allow_public).
	t.Run("owner_sees_org_agents_with_allow_false", func(t *testing.T) {
		objects, err := fgaListObjectsWithContext(t, fga, owner, "can_view", "agent",
			map[string]any{"allow": false})
		require.NoError(t, err)
		assert.Contains(t, objects, publicAgent,
			"owner should see public agent via org membership")
		assert.Contains(t, objects, privateAgent,
			"owner should see private agent via org membership")
	})
}
