package workflow

import (
	"context"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The controller unit harness runs with a nil validator, so the create pipeline
// does not generate CNCF YAML or archive versions. These tests therefore seed
// the store directly with a versioned workflow (a live head plus tagless audit
// entries), which is the deterministic way to exercise the tag move, the live
// head reconcile, and the tag-overlay read paths in isolation.

const (
	tagTestOrg  = "test-org"
	tagTestSlug = "tag-test"
	tagTestID   = "wfl_tagtest"
)

var (
	tagHashV1 = strings.Repeat("a", 64)
	tagHashV2 = strings.Repeat("b", 64)
)

// seededWorkflowVersion builds a workflow snapshot for a single version. The
// embedded metadata.version.tag is intentionally set to a "wrong" value so the
// tests prove the read paths source the tag from the audit column, not the blob.
func seededWorkflowVersion(hash, yaml string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   tagTestID,
			Name: "Tag Test",
			Slug: tagTestSlug,
			Org:  tagTestOrg,
			Version: &apiresource.ApiResourceMetadataVersion{
				Id:  hash,
				Tag: "stale-embedded-tag",
			},
		},
		Status: &workflowv1.WorkflowStatus{
			VersionHash:                  hash,
			ServerlessWorkflowValidation: &serverlessv1.ServerlessWorkflowValidation{Yaml: yaml},
		},
	}
}

// setupTaggedWorkflow seeds a workflow with two tagless archived versions (v1,
// v2) where v2 is the live head, and returns the controller plus a context.
func setupTaggedWorkflow(t *testing.T) (*WorkflowController, context.Context) {
	t.Helper()
	controller, st := setupTestController(t)
	t.Cleanup(func() { st.Close() })

	ctx := contextWithWorkflowKind()
	kind := apiresourcekind.ApiResourceKind_workflow

	head := seededWorkflowVersion(tagHashV2, "yaml-v2")
	require.NoError(t, st.SaveResource(ctx, kind, tagTestID, head))
	require.NoError(t, st.SaveAudit(ctx, kind, tagTestID, seededWorkflowVersion(tagHashV1, "yaml-v1"), tagHashV1, ""))
	require.NoError(t, st.SaveAudit(ctx, kind, tagTestID, head, tagHashV2, ""))

	return controller, ctx
}

func requireGrpcCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok, "expected a gRPC status error, got %v", err)
	require.Equal(t, want, st.Code(), "unexpected gRPC code; err=%v", err)
}

func TestWorkflowController_TagVersion(t *testing.T) {
	t.Run("assigns a tag to an archived version and resolves it by reference", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV1, Tag: "stable",
		})
		require.NoError(t, err)

		byTag, err := controller.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org: tagTestOrg, Slug: tagTestSlug, Version: "stable",
		})
		require.NoError(t, err)
		assert.Equal(t, tagHashV1, byTag.Status.VersionHash, "the tag must resolve to the version it was assigned to")

		// The head (v2) is untagged, so the reconciled live tag is empty.
		head, err := controller.Get(ctx, &workflowv1.WorkflowId{Value: tagTestID})
		require.NoError(t, err)
		assert.Equal(t, "", head.Metadata.GetVersion().GetTag(),
			"tagging an archived version must not leave a stale tag on the live head")
	})

	t.Run("moves a tag to a new version, clearing the prior holder and reconciling the head", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV1, Tag: "stable",
		})
		require.NoError(t, err)

		// Move "stable" to the head (v2).
		_, err = controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV2, Tag: "stable",
		})
		require.NoError(t, err)

		byTag, err := controller.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org: tagTestOrg, Slug: tagTestSlug, Version: "stable",
		})
		require.NoError(t, err)
		assert.Equal(t, tagHashV2, byTag.Status.VersionHash, "the tag must move to the new target")

		// The head now carries the tag (reconciled onto the live resource).
		head, err := controller.Get(ctx, &workflowv1.WorkflowId{Value: tagTestID})
		require.NoError(t, err)
		assert.Equal(t, "stable", head.Metadata.GetVersion().GetTag())

		// v1 is still addressable by hash, but no longer by the moved tag.
		byHash, err := controller.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org: tagTestOrg, Slug: tagTestSlug, Version: tagHashV1,
		})
		require.NoError(t, err)
		assert.Equal(t, tagHashV1, byHash.Status.VersionHash)
		assert.Equal(t, "", byHash.Metadata.GetVersion().GetTag(),
			"the prior holder must no longer advertise the moved tag")
	})

	t.Run("reports a well-formed but unknown hash as NotFound", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: strings.Repeat("f", 64), Tag: "stable",
		})
		requireGrpcCode(t, err, codes.NotFound)
	})

	t.Run("reports a missing workflow as NotFound", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: "wfl_missing", VersionHash: tagHashV1, Tag: "stable",
		})
		requireGrpcCode(t, err, codes.NotFound)
	})

	t.Run("rejects a malformed hash and an empty tag with InvalidArgument", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: "not-a-valid-hash", Tag: "stable",
		})
		requireGrpcCode(t, err, codes.InvalidArgument)

		_, err = controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV1, Tag: "",
		})
		requireGrpcCode(t, err, codes.InvalidArgument)
	})

	t.Run("does not orphan the tag when the target hash is missing", func(t *testing.T) {
		controller, ctx := setupTaggedWorkflow(t)

		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV1, Tag: "stable",
		})
		require.NoError(t, err)

		// A failed move must leave the prior holder untouched.
		_, err = controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: strings.Repeat("c", 64), Tag: "stable",
		})
		requireGrpcCode(t, err, codes.NotFound)

		byTag, err := controller.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org: tagTestOrg, Slug: tagTestSlug, Version: "stable",
		})
		require.NoError(t, err)
		assert.Equal(t, tagHashV1, byTag.Status.VersionHash, "the tag must still resolve to its original holder")
	})
}

func TestWorkflowController_VersionReadPaths_ReflectTagMove(t *testing.T) {
	controller, ctx := setupTaggedWorkflow(t)

	_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
		WorkflowId: tagTestID, VersionHash: tagHashV1, Tag: "stable",
	})
	require.NoError(t, err)

	t.Run("listVersions sources the tag from the audit column", func(t *testing.T) {
		resp, err := controller.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{
			Org: tagTestOrg, Slug: tagTestSlug,
		})
		require.NoError(t, err)
		require.Len(t, resp.Versions, 2)

		tagByHash := make(map[string]string, len(resp.Versions))
		for _, entry := range resp.Versions {
			tagByHash[entry.VersionHash] = entry.Tag
		}
		assert.Equal(t, "stable", tagByHash[tagHashV1], "the tagged version reflects the column tag, not the stale blob")
		assert.Equal(t, "", tagByHash[tagHashV2], "the untagged head carries no tag")
	})

	t.Run("getVersion sources the tag from the audit column for an archived version", func(t *testing.T) {
		entry, err := controller.GetVersion(ctx, &workflowv1.GetWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV1,
		})
		require.NoError(t, err)
		assert.Equal(t, "stable", entry.Tag)
		assert.False(t, entry.IsCurrent)
	})

	t.Run("getVersion returns the reconciled tag for the head", func(t *testing.T) {
		// Move the tag onto the head, then read it back.
		_, err := controller.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV2, Tag: "stable",
		})
		require.NoError(t, err)

		entry, err := controller.GetVersion(ctx, &workflowv1.GetWorkflowVersionInput{
			WorkflowId: tagTestID, VersionHash: tagHashV2,
		})
		require.NoError(t, err)
		assert.True(t, entry.IsCurrent)
		assert.Equal(t, "stable", entry.Tag)
	})
}
