//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// Workflow versioning is content-addressed: a version is the immutable SHA-256
// of the generated CNCF Serverless Workflow YAML. Applying a workflow whose
// generated YAML differs from the current head creates a new version; applying
// byte-identical content is a no-op for version history (like committing an
// unchanged tree in git).
//
// These tests exercise the real cloud (Java) versioning path end-to-end via the
// apply RPC — the same RPC `stigmer apply` / `stigmer seedpack apply` use — and
// assert the two invariants that matter to users:
//
//  1. Distinct content accumulates versions (the "I only ever see one version"
//     report would manifest here as a single version after two distinct applies).
//  2. Identical content does NOT create a new version AND does not corrupt the
//     head's version_hash (a regression guard for the archival change-gate).

// buildVersionedWorkflow returns a minimal, valid workflow whose generated YAML
// is driven by varValue, so two calls with different varValue produce two
// distinct content hashes while sharing the same (org, slug) identity.
func buildVersionedWorkflow(t *testing.T, name, varValue string) *workflowv1.Workflow {
	t.Helper()
	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"ok": varValue},
	})
	require.NoError(t, err, "build workflow task config")

	return &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Workflow versioning integration test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "noop",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}

func TestWorkflowVersioning_DistinctContentCreatesNewVersion(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-wf-%s", uuid.New().String()[:8])

	// First apply → version 1.
	wf1, err := clients.WorkflowCommand.Apply(ctx, buildVersionedWorkflow(t, name, "v1"))
	require.NoError(t, err, "first apply should create the workflow")

	workflowID := wf1.GetMetadata().GetId()
	org := wf1.GetMetadata().GetOrg()
	slug := wf1.GetMetadata().GetSlug()
	hash1 := wf1.GetStatus().GetVersionHash()
	require.NotEmpty(t, workflowID, "create must assign an ID")
	require.NotEmpty(t, hash1, "create must assign a version hash to the head")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.WorkflowCommand.Delete(cleanCtx, &workflowv1.WorkflowId{Value: workflowID}); err != nil {
			t.Logf("warning: failed to clean up workflow %s: %v", workflowID, err)
		}
	})

	list1, err := clients.WorkflowQuery.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions after first apply should succeed")
	require.Len(t, list1.GetVersions(), 1, "exactly one version should exist after the first apply")
	assert.Equal(t, int32(1), list1.GetTotalCount(), "total_count should be 1")
	assert.True(t, list1.GetVersions()[0].GetIsCurrent(), "the sole version must be marked current")
	assert.Equal(t, hash1, list1.GetVersions()[0].GetVersionHash(), "listed version hash must match the head hash")

	// Second apply with changed content → version 2.
	wf2, err := clients.WorkflowCommand.Apply(ctx, buildVersionedWorkflow(t, name, "v2-changed"))
	require.NoError(t, err, "second apply should update the workflow (upsert by org+slug)")
	require.Equal(t, workflowID, wf2.GetMetadata().GetId(), "apply must upsert by (org, slug), preserving the ID")

	hash2 := wf2.GetStatus().GetVersionHash()
	require.NotEmpty(t, hash2, "update must assign a version hash to the head")
	require.NotEqual(t, hash1, hash2, "changed content must produce a different content hash")

	list2, err := clients.WorkflowQuery.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions after second apply should succeed")
	require.Len(t, list2.GetVersions(), 2, "two versions should exist after a distinct second apply")
	assert.Equal(t, int32(2), list2.GetTotalCount(), "total_count should be 2")

	// Newest first, current flag on the head.
	assert.Equal(t, hash2, list2.GetVersions()[0].GetVersionHash(), "newest version (head) must be first")
	assert.True(t, list2.GetVersions()[0].GetIsCurrent(), "newest version must be current")
	assert.Equal(t, hash1, list2.GetVersions()[1].GetVersionHash(), "older version must be second")
	assert.False(t, list2.GetVersions()[1].GetIsCurrent(), "older version must not be current")

	// GetVersion resolves the older immutable version by hash.
	olderEntry, err := clients.WorkflowQuery.GetVersion(ctx, &workflowv1.GetWorkflowVersionInput{
		WorkflowId:  workflowID,
		VersionHash: hash1,
	})
	require.NoError(t, err, "getVersion by hash should resolve the older version")
	assert.Equal(t, hash1, olderEntry.GetVersionHash(), "getVersion must return the requested version")

	// GetByReference with no version pin resolves the current head.
	latest, err := clients.WorkflowQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  org,
		Slug: slug,
		Kind: apiresourcekind.ApiResourceKind_workflow,
	})
	require.NoError(t, err, "getByReference (latest) should succeed")
	assert.Equal(t, hash2, latest.GetStatus().GetVersionHash(), "latest must resolve to the newest version")

	t.Logf("workflow versioning verified: id=%s, v1=%s, v2=%s", workflowID, hash1[:12], hash2[:12])
}

func TestWorkflowVersioning_IdenticalApplyDoesNotCreateVersion(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-wf-idem-%s", uuid.New().String()[:8])

	wf1, err := clients.WorkflowCommand.Apply(ctx, buildVersionedWorkflow(t, name, "v1"))
	require.NoError(t, err, "first apply should create the workflow")

	workflowID := wf1.GetMetadata().GetId()
	org := wf1.GetMetadata().GetOrg()
	slug := wf1.GetMetadata().GetSlug()
	hash1 := wf1.GetStatus().GetVersionHash()
	require.NotEmpty(t, hash1, "create must assign a version hash")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.WorkflowCommand.Delete(cleanCtx, &workflowv1.WorkflowId{Value: workflowID}); err != nil {
			t.Logf("warning: failed to clean up workflow %s: %v", workflowID, err)
		}
	})

	// Re-apply byte-identical content. This must be a version no-op.
	wf1b, err := clients.WorkflowCommand.Apply(ctx, buildVersionedWorkflow(t, name, "v1"))
	require.NoError(t, err, "identical re-apply should succeed")
	require.Equal(t, workflowID, wf1b.GetMetadata().GetId(), "identical re-apply must upsert the same workflow")

	// Regression guard: the head must NOT lose its version hash on an idempotent
	// apply (a previously-suspected corruption mode).
	assert.Equal(t, hash1, wf1b.GetStatus().GetVersionHash(),
		"identical re-apply must preserve the head version_hash, not wipe it")

	list, err := clients.WorkflowQuery.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions should succeed")
	require.Len(t, list.GetVersions(), 1, "identical re-apply must NOT create a second version")
	assert.Equal(t, int32(1), list.GetTotalCount(), "total_count should remain 1")
	assert.True(t, list.GetVersions()[0].GetIsCurrent(), "the sole version must remain current")
	assert.Equal(t, hash1, list.GetVersions()[0].GetVersionHash(), "the sole version hash must be unchanged")

	t.Logf("workflow idempotent apply verified: id=%s, hash=%s (1 version)", workflowID, hash1[:12])
}
