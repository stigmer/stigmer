package artifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func ctxWithArtifactKind() context.Context {
	return context.WithValue(context.Background(),
		apiresourceinterceptor.ApiResourceKindKey,
		apiresourcekind.ApiResourceKind_artifact)
}

type testEnv struct {
	ctrl    *ArtifactController
	store   store.Store
	storage *fakeArtifactStorage
}

func setup(t *testing.T) *testEnv {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	fs := &fakeArtifactStorage{blobs: make(map[string][]byte)}
	return &testEnv{
		ctrl:    NewArtifactController(s, fs),
		store:   s,
		storage: fs,
	}
}

func validCreateInput(content []byte) *artifactv1.CreateArtifactInput {
	return &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "application/json",
			DisplayName: "test output",
			Source: &artifactv1.ArtifactSource{
				WorkflowExecutionId: "wex_test123",
				TaskName:            "analyze",
			},
		},
		Content: content,
	}
}

// ---- Create ----

func TestCreate_ValidInput_ReturnsArtifactWithCorrectFields(t *testing.T) {
	env := setup(t)
	content := []byte(`{"result": "hello world"}`)
	hash := sha256.Sum256(content)
	expectedHash := hex.EncodeToString(hash[:])

	artifact, err := env.ctrl.Create(ctxWithArtifactKind(), validCreateInput(content))
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if !strings.HasPrefix(artifact.GetMetadata().GetId(), "art_") {
		t.Errorf("expected ID prefix art_, got %s", artifact.GetMetadata().GetId())
	}
	if artifact.GetStatus().GetContentHash() != expectedHash {
		t.Errorf("expected hash %s, got %s", expectedHash, artifact.GetStatus().GetContentHash())
	}
	if artifact.GetStatus().GetSizeBytes() != int64(len(content)) {
		t.Errorf("expected size %d, got %d", len(content), artifact.GetStatus().GetSizeBytes())
	}
	if artifact.GetStatus().GetStorageState() != artifactv1.ArtifactStorageState_storage_state_stored {
		t.Errorf("expected storage_state_stored, got %s", artifact.GetStatus().GetStorageState())
	}
	if artifact.GetSpec().GetContentType() != "application/json" {
		t.Errorf("expected content_type application/json, got %s", artifact.GetSpec().GetContentType())
	}
	if artifact.GetSpec().GetDisplayName() != "test output" {
		t.Errorf("expected display_name 'test output', got %s", artifact.GetSpec().GetDisplayName())
	}

	// Verify blob was uploaded to storage with hash as key
	if _, ok := env.storage.blobs[expectedHash]; !ok {
		t.Error("expected blob to be uploaded to storage with content hash key")
	}
}

func TestCreate_MissingSpec_ReturnsInvalidArgument(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.Create(ctxWithArtifactKind(), &artifactv1.CreateArtifactInput{
		Content: []byte("hello"),
	})
	assertGRPCCode(t, err, codes.InvalidArgument)
}

func TestCreate_MissingContent_ReturnsInvalidArgument(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.Create(ctxWithArtifactKind(), &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "text/plain",
			DisplayName: "empty",
			Source:      &artifactv1.ArtifactSource{WorkflowExecutionId: "wex_1"},
		},
	})
	assertGRPCCode(t, err, codes.InvalidArgument)
}

func TestCreate_MissingSource_ReturnsInvalidArgument(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.Create(ctxWithArtifactKind(), &artifactv1.CreateArtifactInput{
		Spec: &artifactv1.ArtifactSpec{
			ContentType: "text/plain",
			DisplayName: "no source",
		},
		Content: []byte("data"),
	})
	assertGRPCCode(t, err, codes.InvalidArgument)
}

func TestCreate_StorageUnavailable_ReturnsInternal(t *testing.T) {
	env := setup(t)
	env.ctrl.artifactStorage = nil
	_, err := env.ctrl.Create(ctxWithArtifactKind(), validCreateInput([]byte("data")))
	assertGRPCCode(t, err, codes.Internal)
}

func TestCreate_BlobUploadFailure_ReturnsInternal(t *testing.T) {
	env := setup(t)
	env.storage.failUpload = true
	_, err := env.ctrl.Create(ctxWithArtifactKind(), validCreateInput([]byte("data")))
	assertGRPCCode(t, err, codes.Internal)
}

// ---- Get ----

func TestGet_ExistingArtifact_ReturnsIt(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	created, err := env.ctrl.Create(ctx, validCreateInput([]byte("get-me")))
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	got, err := env.ctrl.Get(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.GetMetadata().GetId() != created.GetMetadata().GetId() {
		t.Errorf("expected ID %s, got %s", created.GetMetadata().GetId(), got.GetMetadata().GetId())
	}
}

func TestGet_NonExistent_ReturnsNotFound(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.Get(ctxWithArtifactKind(), &artifactv1.ArtifactId{Value: "art_nonexistent"})
	assertGRPCCode(t, err, codes.NotFound)
}

// ---- ListByExecution ----

func TestListByExecution_FiltersByWorkflowExecutionId(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	// Create 2 artifacts for wex_A, 1 for wex_B
	for _, wex := range []string{"wex_A", "wex_A", "wex_B"} {
		input := validCreateInput([]byte("data-" + wex))
		input.Spec.Source = &artifactv1.ArtifactSource{
			WorkflowExecutionId: wex,
			TaskName:            "t1",
		}
		if _, err := env.ctrl.Create(ctx, input); err != nil {
			t.Fatalf("Create failed: %v", err)
		}
	}

	list, err := env.ctrl.ListByExecution(ctx, &artifactv1.ListArtifactsByExecutionRequest{
		WorkflowExecutionId: "wex_A",
	})
	if err != nil {
		t.Fatalf("ListByExecution failed: %v", err)
	}
	if len(list.GetEntries()) != 2 {
		t.Errorf("expected 2 artifacts for wex_A, got %d", len(list.GetEntries()))
	}
}

func TestListByExecution_FiltersByAgentExecutionId(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	input := validCreateInput([]byte("agent-data"))
	input.Spec.Source = &artifactv1.ArtifactSource{AgentExecutionId: "aex_test"}
	if _, err := env.ctrl.Create(ctx, input); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	list, err := env.ctrl.ListByExecution(ctx, &artifactv1.ListArtifactsByExecutionRequest{
		AgentExecutionId: "aex_test",
	})
	if err != nil {
		t.Fatalf("ListByExecution failed: %v", err)
	}
	if len(list.GetEntries()) != 1 {
		t.Errorf("expected 1 artifact, got %d", len(list.GetEntries()))
	}
}

func TestListByExecution_NoFilter_ReturnsInvalidArgument(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.ListByExecution(ctxWithArtifactKind(), &artifactv1.ListArtifactsByExecutionRequest{})
	assertGRPCCode(t, err, codes.InvalidArgument)
}

func TestListByExecution_NoMatches_ReturnsEmptyList(t *testing.T) {
	env := setup(t)
	list, err := env.ctrl.ListByExecution(ctxWithArtifactKind(), &artifactv1.ListArtifactsByExecutionRequest{
		WorkflowExecutionId: "wex_nonexistent",
	})
	if err != nil {
		t.Fatalf("ListByExecution failed: %v", err)
	}
	if len(list.GetEntries()) != 0 {
		t.Errorf("expected empty list, got %d entries", len(list.GetEntries()))
	}
}

// ---- GetDownloadUrl ----

func TestGetDownloadUrl_ExistingArtifact_ReturnsUrl(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	created, err := env.ctrl.Create(ctx, validCreateInput([]byte("downloadable")))
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	dl, err := env.ctrl.GetDownloadUrl(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("GetDownloadUrl failed: %v", err)
	}
	if dl.GetUrl() == "" {
		t.Error("expected non-empty URL")
	}
	if dl.GetTtlSeconds() <= 0 {
		t.Error("expected positive TTL")
	}
	if dl.GetSizeBytes() != int64(len("downloadable")) {
		t.Errorf("expected size %d, got %d", len("downloadable"), dl.GetSizeBytes())
	}
	if dl.GetContentType() != "application/json" {
		t.Errorf("expected content_type application/json, got %s", dl.GetContentType())
	}
}

func TestGetDownloadUrl_DeletedArtifact_ReturnsFailedPrecondition(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	created, err := env.ctrl.Create(ctx, validCreateInput([]byte("to-delete")))
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	_, err = env.ctrl.Delete(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err = env.ctrl.GetDownloadUrl(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	assertGRPCCode(t, err, codes.FailedPrecondition)
}

func TestGetDownloadUrl_NonExistent_ReturnsNotFound(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.GetDownloadUrl(ctxWithArtifactKind(), &artifactv1.ArtifactId{Value: "art_nope"})
	assertGRPCCode(t, err, codes.NotFound)
}

// ---- Delete ----

func TestDelete_ExistingArtifact_TransitionsState(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()

	created, err := env.ctrl.Create(ctx, validCreateInput([]byte("delete-me")))
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	deleted, err := env.ctrl.Delete(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if deleted.GetStatus().GetStorageState() != artifactv1.ArtifactStorageState_storage_state_deleted {
		t.Errorf("expected storage_state_deleted, got %s", deleted.GetStatus().GetStorageState())
	}

	// Verify persisted state
	got, err := env.ctrl.Get(ctx, &artifactv1.ArtifactId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Get after delete failed: %v", err)
	}
	if got.GetStatus().GetStorageState() != artifactv1.ArtifactStorageState_storage_state_deleted {
		t.Errorf("persisted state should be deleted, got %s", got.GetStatus().GetStorageState())
	}
}

func TestDelete_NonExistent_ReturnsNotFound(t *testing.T) {
	env := setup(t)
	_, err := env.ctrl.Delete(ctxWithArtifactKind(), &apiresource.ApiResourceId{Value: "art_nope"})
	assertGRPCCode(t, err, codes.NotFound)
}

// ---- Content Hash Deduplication ----

func TestCreate_IdenticalContent_ProducesSameHash(t *testing.T) {
	env := setup(t)
	ctx := ctxWithArtifactKind()
	content := []byte(`{"dedup": true}`)

	a1, err := env.ctrl.Create(ctx, validCreateInput(content))
	if err != nil {
		t.Fatalf("first Create failed: %v", err)
	}

	input2 := validCreateInput(content)
	input2.Spec.DisplayName = "second artifact"
	a2, err := env.ctrl.Create(ctx, input2)
	if err != nil {
		t.Fatalf("second Create failed: %v", err)
	}

	if a1.GetMetadata().GetId() == a2.GetMetadata().GetId() {
		t.Error("two creates with same content should produce different IDs")
	}
	if a1.GetStatus().GetContentHash() != a2.GetStatus().GetContentHash() {
		t.Error("two creates with same content should produce the same hash")
	}
}

// ---- helpers ----

func assertGRPCCode(t *testing.T, err error, expected codes.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error with code %s, got nil", expected)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != expected {
		t.Errorf("expected code %s, got %s: %s", expected, st.Code(), st.Message())
	}
}

// fakeArtifactStorage is an in-memory implementation for unit tests.
type fakeArtifactStorage struct {
	blobs      map[string][]byte
	failUpload bool
}

func (f *fakeArtifactStorage) Upload(_ context.Context, key string, data []byte, _ string) error {
	if f.failUpload {
		return context.DeadlineExceeded
	}
	f.blobs[key] = data
	return nil
}

func (f *fakeArtifactStorage) Download(_ context.Context, key string) ([]byte, error) {
	d, ok := f.blobs[key]
	if !ok {
		return nil, context.DeadlineExceeded
	}
	return d, nil
}

func (f *fakeArtifactStorage) GetSignedURL(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://localhost:7235/" + key, nil
}

func (f *fakeArtifactStorage) Delete(_ context.Context, key string) error {
	delete(f.blobs, key)
	return nil
}

func (f *fakeArtifactStorage) Exists(_ context.Context, key string) (bool, error) {
	_, ok := f.blobs[key]
	return ok, nil
}

func (f *fakeArtifactStorage) Health(_ context.Context) error {
	return nil
}
