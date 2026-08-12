//go:build integration

package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newSourceExecution deploys a trivial workflow and creates one execution for
// it, returning the execution's id for use as an artifact source.
//
// Artifact fixtures need REAL executions: artifact authorization anchors to
// the source execution's org — the service resolves spec.source against the
// store at create time and rejects unresolvable references with
// FailedPrecondition (stigmer-cloud PR #295; pinned by
// TestArtifact_Create_UnresolvableSourceRejected), and ListByExecution
// authorizes can_view against the parent execution named in the request. A
// fabricated wex_* id cannot work anywhere in this suite.
//
// The execution record is persisted and org-stamped by the create RPC itself,
// so no phase wait — and no unified runner — is needed before artifacts can
// anchor to it.
func newSourceExecution(t *testing.T, ctx context.Context, deployer *harness.FixtureDeployer, workflowName string) string {
	t.Helper()

	wf, err := fastWorkflow(workflowName)
	require.NoError(t, err, "build source workflow fixture")

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "artifact source execution")
	require.NoError(t, err, "deploy and execute source workflow")

	return execution.GetMetadata().GetId()
}

func TestArtifact_CreateAndGet(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "artifact-create", suiteLogger)
	defer deployer.Cleanup(ctx)

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)
	queryClient := artifactv1.NewArtifactQueryControllerClient(grpcConn)

	sourceExecutionID := newSourceExecution(t, ctx, deployer, "integration-test-artifact-create")

	content := []byte(`{"analysis": "test result", "score": 42}`)
	hash := sha256.Sum256(content)
	expectedHash := hex.EncodeToString(hash[:])

	created, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "application/json",
			DisplayName: "analysis output",
			Source: &artifactv1.ArtifactSource{
				WorkflowExecutionId: sourceExecutionID,
				TaskName:            "analyze",
			},
		},
		Content: content,
	})
	require.NoError(t, err, "Create should succeed")
	require.NotNil(t, created)

	assert.True(t, strings.HasPrefix(created.GetMetadata().GetId(), "art_"),
		"ID should have art_ prefix, got %s", created.GetMetadata().GetId())
	assert.Equal(t, "agentic.stigmer.ai/v1", created.GetApiVersion())
	assert.Equal(t, "Artifact", created.GetKind())
	assert.Equal(t, "application/json", created.GetSpec().GetContentType())
	assert.Equal(t, "analysis output", created.GetSpec().GetDisplayName())
	assert.Equal(t, expectedHash, created.GetStatus().GetContentHash())
	assert.Equal(t, int64(len(content)), created.GetStatus().GetSizeBytes())
	assert.Equal(t, artifactv1.ArtifactStorageState_storage_state_stored, created.GetStatus().GetStorageState())

	// Get the created artifact
	got, err := queryClient.Get(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err, "Get should succeed")
	assert.Equal(t, created.GetMetadata().GetId(), got.GetMetadata().GetId())
	assert.Equal(t, expectedHash, got.GetStatus().GetContentHash())
}

func TestArtifact_ListByWorkflowExecution(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "artifact-list", suiteLogger)
	defer deployer.Cleanup(ctx)

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)
	queryClient := artifactv1.NewArtifactQueryControllerClient(grpcConn)

	// Two distinct source executions: list-by-A must not see B's artifact.
	// Execution ids are server-minted ULIDs, so the count assertion below
	// cannot collide with artifacts from other tests.
	wexA := newSourceExecution(t, ctx, deployer, "integration-test-artifact-list-a")
	wexB := newSourceExecution(t, ctx, deployer, "integration-test-artifact-list-b")

	for i, wex := range []string{wexA, wexA, wexB} {
		_, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
			Spec: &artifactv1.ArtifactSpec{
				ContentType: "text/plain",
				DisplayName: "output",
				Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: wex, TaskName: "t"},
			},
			Content: []byte("data-" + string(rune('A'+i))),
		})
		require.NoError(t, err)
	}

	list, err := queryClient.ListByExecution(ctx, &artifactv1.ListArtifactsByExecutionRequest{
		WorkflowExecutionId: wexA,
	})
	require.NoError(t, err)
	assert.Equal(t, 2, len(list.GetEntries()),
		"expected 2 artifacts for wexA, got %d", len(list.GetEntries()))
}

func TestArtifact_GetDownloadUrl_LocalStorage(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "artifact-dl", suiteLogger)
	defer deployer.Cleanup(ctx)

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)
	queryClient := artifactv1.NewArtifactQueryControllerClient(grpcConn)

	sourceExecutionID := newSourceExecution(t, ctx, deployer, "integration-test-artifact-dl")

	created, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "text/plain",
			DisplayName: "downloadable file",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: sourceExecutionID},
		},
		Content: []byte("downloadable content"),
	})
	require.NoError(t, err)

	dl, err := queryClient.GetDownloadUrl(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.NotEmpty(t, dl.GetUrl(), "download URL should not be empty")
	assert.True(t, dl.GetTtlSeconds() > 0, "TTL should be positive")
	assert.Equal(t, int64(len("downloadable content")), dl.GetSizeBytes())
	assert.Equal(t, "text/plain", dl.GetContentType())
}

func TestArtifact_Delete_SoftDelete(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "artifact-del", suiteLogger)
	defer deployer.Cleanup(ctx)

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)
	queryClient := artifactv1.NewArtifactQueryControllerClient(grpcConn)

	sourceExecutionID := newSourceExecution(t, ctx, deployer, "integration-test-artifact-del")

	created, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "text/plain",
			DisplayName: "ephemeral",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: sourceExecutionID},
		},
		Content: []byte("will be deleted"),
	})
	require.NoError(t, err)

	deleted, err := commandClient.Delete(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, artifactv1.ArtifactStorageState_storage_state_deleted, deleted.GetStatus().GetStorageState())

	// Get still works (soft delete)
	got, err := queryClient.Get(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, artifactv1.ArtifactStorageState_storage_state_deleted, got.GetStatus().GetStorageState())

	// Download URL returns FailedPrecondition for deleted artifact
	_, err = queryClient.GetDownloadUrl(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
}

func TestArtifact_ContentHashDedup(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "artifact-dedup", suiteLogger)
	defer deployer.Cleanup(ctx)

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)

	// One source execution for both creates: the claim under test is
	// "same content, distinct artifacts, same hash" — the source is not
	// part of the dedup key.
	sourceExecutionID := newSourceExecution(t, ctx, deployer, "integration-test-artifact-dedup")

	content := []byte(`{"dedup": "test"}`)

	a1, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "application/json",
			DisplayName: "first",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: sourceExecutionID},
		},
		Content: content,
	})
	require.NoError(t, err)

	a2, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "application/json",
			DisplayName: "second",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: sourceExecutionID},
		},
		Content: content,
	})
	require.NoError(t, err)

	assert.NotEqual(t, a1.GetMetadata().GetId(), a2.GetMetadata().GetId(),
		"different artifacts should have different IDs")
	assert.Equal(t, a1.GetStatus().GetContentHash(), a2.GetStatus().GetContentHash(),
		"same content should produce the same content hash")
}

// TestArtifact_Create_UnresolvableSourceRejected pins the enforcement that
// broke this suite when it landed service-side (stigmer-cloud PR #295 /
// oss#447): artifact create anchors authorization to the source execution's
// org, so a source that resolves to no persisted execution must be rejected
// with FailedPrecondition instead of minting an unanchored artifact.
func TestArtifact_Create_UnresolvableSourceRejected(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)

	_, err := commandClient.Create(ctx, &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "text/plain",
			DisplayName: "orphan",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: "wex_never_persisted"},
		},
		Content: []byte("content with no anchoring execution"),
	})
	require.Error(t, err, "create with an unresolvable source execution must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
}

func TestArtifact_NotFound(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queryClient := artifactv1.NewArtifactQueryControllerClient(grpcConn)
	commandClient := artifactv1.NewArtifactCommandControllerClient(grpcConn)

	t.Run("get non-existent returns NOT_FOUND", func(t *testing.T) {
		_, err := queryClient.Get(ctx, &artifactv1.ArtifactId{Value: "art_nonexistent"})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
	})

	t.Run("delete non-existent returns NOT_FOUND", func(t *testing.T) {
		_, err := commandClient.Delete(ctx, &apiresource.ApiResourceId{Value: "art_nonexistent"})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
	})

	t.Run("getDownloadUrl non-existent returns NOT_FOUND", func(t *testing.T) {
		_, err := queryClient.GetDownloadUrl(ctx, &artifactv1.ArtifactId{Value: "art_nonexistent"})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
	})
}
