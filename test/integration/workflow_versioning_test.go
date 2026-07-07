//go:build integration

package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

// buildTaggedWorkflow is buildVersionedWorkflow with an apply-time version tag
// (metadata.version.tag), the same field the CLI's `--tag` flag populates.
func buildTaggedWorkflow(t *testing.T, name, varValue, tag string) *workflowv1.Workflow {
	t.Helper()
	wf := buildVersionedWorkflow(t, name, varValue)
	wf.Metadata.Version = &apiresource.ApiResourceMetadataVersion{Tag: tag}
	return wf
}

// TestWorkflowVersioning_TagVersionMovesTagAndResolves proves the tagVersion RPC
// moves a tag end-to-end: the tag stops resolving to its prior holder and starts
// resolving to the new target, the immutable hash still resolves, and the live
// head reflects the moved tag (the reconcile invariant).
func TestWorkflowVersioning_TagVersionMovesTagAndResolves(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-wf-tag-%s", uuid.New().String()[:8])

	// v1 carries an apply-time tag; v2 (changed, untagged) becomes the head.
	wf1, err := clients.WorkflowCommand.Apply(ctx, buildTaggedWorkflow(t, name, "v1", "stable"))
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

	wf2, err := clients.WorkflowCommand.Apply(ctx, buildVersionedWorkflow(t, name, "v2-changed"))
	require.NoError(t, err, "second apply should update the workflow")
	hash2 := wf2.GetStatus().GetVersionHash()
	require.NotEqual(t, hash1, hash2, "changed content must produce a new version")

	ref := func(version string) *apiresource.ApiResourceReference {
		return &apiresource.ApiResourceReference{
			Org:     org,
			Slug:    slug,
			Version: version,
			Kind:    apiresourcekind.ApiResourceKind_workflow,
		}
	}

	// The apply-time tag resolves to v1.
	byTag, err := clients.WorkflowQuery.GetByReference(ctx, ref("stable"))
	require.NoError(t, err, "getByReference by apply-time tag should succeed")
	assert.Equal(t, hash1, byTag.GetStatus().GetVersionHash(), "apply-time tag must resolve to v1")

	// Move the tag to the head (v2).
	_, err = clients.WorkflowCommand.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
		WorkflowId: workflowID, VersionHash: hash2, Tag: "stable",
	})
	require.NoError(t, err, "tagVersion should move the tag to the head")

	// "stable" now resolves to v2; v1 stays addressable by its immutable hash.
	byTagMoved, err := clients.WorkflowQuery.GetByReference(ctx, ref("stable"))
	require.NoError(t, err)
	assert.Equal(t, hash2, byTagMoved.GetStatus().GetVersionHash(), "tagVersion must move the tag to v2")

	byHash1, err := clients.WorkflowQuery.GetByReference(ctx, ref(hash1))
	require.NoError(t, err)
	assert.Equal(t, hash1, byHash1.GetStatus().GetVersionHash(), "the immutable hash must still resolve to v1")
	assert.Empty(t, byHash1.GetMetadata().GetVersion().GetTag(), "v1 must no longer advertise the moved tag")

	// The live head reflects the moved tag (reconcile invariant).
	head, err := clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: workflowID})
	require.NoError(t, err)
	assert.Equal(t, "stable", head.GetMetadata().GetVersion().GetTag(), "the live head must reflect the moved tag")

	// listVersions reflects single-holder: only v2 carries the tag now.
	list, err := clients.WorkflowQuery.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err)
	require.Len(t, list.GetVersions(), 2)
	tagByHash := map[string]string{}
	for _, entry := range list.GetVersions() {
		tagByHash[entry.GetVersionHash()] = entry.GetTag()
	}
	assert.Equal(t, "stable", tagByHash[hash2], "the head must hold the moved tag")
	assert.Equal(t, "", tagByHash[hash1], "the prior holder must be cleared")

	// A well-formed but unknown hash is NotFound.
	_, err = clients.WorkflowCommand.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
		WorkflowId: workflowID, VersionHash: strings.Repeat("f", 64), Tag: "stable",
	})
	requireGrpcStatus(t, err, codes.NotFound)
}

// TestWorkflowVersioning_ApplyTimeTagIsSingleHolder proves apply-time tagging and
// the tagVersion RPC share one single-holder model: applying the same tag to two
// successive changed versions leaves the tag on exactly one (the newer), and
// tagVersion can move it back.
func TestWorkflowVersioning_ApplyTimeTagIsSingleHolder(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-wf-single-%s", uuid.New().String()[:8])

	wf1, err := clients.WorkflowCommand.Apply(ctx, buildTaggedWorkflow(t, name, "v1", "prod"))
	require.NoError(t, err)
	workflowID := wf1.GetMetadata().GetId()
	org := wf1.GetMetadata().GetOrg()
	slug := wf1.GetMetadata().GetSlug()
	hash1 := wf1.GetStatus().GetVersionHash()

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.WorkflowCommand.Delete(cleanCtx, &workflowv1.WorkflowId{Value: workflowID}); err != nil {
			t.Logf("warning: failed to clean up workflow %s: %v", workflowID, err)
		}
	})

	// Apply a changed version carrying the SAME tag.
	wf2, err := clients.WorkflowCommand.Apply(ctx, buildTaggedWorkflow(t, name, "v2-changed", "prod"))
	require.NoError(t, err)
	hash2 := wf2.GetStatus().GetVersionHash()
	require.NotEqual(t, hash1, hash2)

	ref := func(version string) *apiresource.ApiResourceReference {
		return &apiresource.ApiResourceReference{
			Org: org, Slug: slug, Version: version, Kind: apiresourcekind.ApiResourceKind_workflow,
		}
	}

	// The tag names exactly one version: the newer one.
	byTag, err := clients.WorkflowQuery.GetByReference(ctx, ref("prod"))
	require.NoError(t, err)
	assert.Equal(t, hash2, byTag.GetStatus().GetVersionHash(), "re-applying a tag must move it to the newer version")

	list, err := clients.WorkflowQuery.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err)
	tagByHash := map[string]string{}
	for _, entry := range list.GetVersions() {
		tagByHash[entry.GetVersionHash()] = entry.GetTag()
	}
	assert.Equal(t, "prod", tagByHash[hash2])
	assert.Equal(t, "", tagByHash[hash1], "apply-time tagging must not leave the tag on the older version")

	// tagVersion can move the same tag back to v1 — one shared single-holder model.
	_, err = clients.WorkflowCommand.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
		WorkflowId: workflowID, VersionHash: hash1, Tag: "prod",
	})
	require.NoError(t, err)

	movedBack, err := clients.WorkflowQuery.GetByReference(ctx, ref("prod"))
	require.NoError(t, err)
	assert.Equal(t, hash1, movedBack.GetStatus().GetVersionHash(), "tagVersion must move the tag back to v1")
}

func requireGrpcStatus(t *testing.T, err error, want codes.Code) {
	t.Helper()
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok, "expected a gRPC status error, got %v", err)
	require.Equal(t, want, st.Code(), "unexpected gRPC code; err=%v", err)
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
