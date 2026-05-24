package artifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	storelib "github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	maxContentBytes    = 50 * 1024 * 1024 // 50 MB
	defaultTTLDays     = 30
	permanentTTLMarker = -1
)

// Create persists a new Artifact with its content blob.
//
// This is a direct handler (not a pipeline) because CreateArtifactInput
// is a non-standard input type (spec + content bytes) that does not
// satisfy HasMetadata.
//
// Steps:
// 1. Validate spec and content
// 2. SHA-256 hash the content (used as blob storage key)
// 3. Upload blob to artifact storage
// 4. Build the Artifact proto with generated ID and populated status
// 5. Derive org from the producing execution
// 6. Persist metadata to the resource store
func (c *ArtifactController) Create(ctx context.Context, input *artifactv1.CreateArtifactInput) (*artifactv1.Artifact, error) {
	if c.artifactStorage == nil {
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	// --- Validate ---

	spec := input.GetSpec()
	if spec == nil {
		return nil, status.Error(codes.InvalidArgument, "spec is required")
	}
	content := input.GetContent()
	if len(content) == 0 {
		return nil, status.Error(codes.InvalidArgument, "content is required")
	}
	if len(content) > maxContentBytes {
		return nil, status.Error(codes.ResourceExhausted,
			fmt.Sprintf("content exceeds maximum size of %d bytes", maxContentBytes))
	}
	source := spec.GetSource()
	if source == nil || (source.GetWorkflowExecutionId() == "" && source.GetAgentExecutionId() == "") {
		return nil, status.Error(codes.InvalidArgument,
			"spec.source must include workflow_execution_id or agent_execution_id")
	}

	// --- Hash content ---

	hash := sha256.Sum256(content)
	contentHash := hex.EncodeToString(hash[:])

	log.Info().
		Str("content_hash", contentHash).
		Int("content_size", len(content)).
		Str("content_type", spec.GetContentType()).
		Str("display_name", spec.GetDisplayName()).
		Msg("Creating artifact")

	// --- Upload blob (content-addressable by hash) ---

	if err := c.artifactStorage.Upload(ctx, contentHash, content, spec.GetContentType()); err != nil {
		log.Error().Err(err).Str("content_hash", contentHash).Msg("Failed to upload artifact blob")
		return nil, status.Errorf(codes.Internal, "failed to upload artifact content: %v", err)
	}

	// --- Derive org from producing execution ---

	org := deriveOrgFromSource(ctx, c.store, source)

	// --- Build Artifact proto ---

	artifactID := steps.GenerateID("art")

	artifact := &artifactv1.Artifact{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Artifact",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   artifactID,
			Name: spec.GetDisplayName(),
			Org:  org,
		},
		Spec: spec,
		Status: &artifactv1.ArtifactStatus{
			ContentHash:  contentHash,
			SizeBytes:    int64(len(content)),
			StorageState: artifactv1.ArtifactStorageState_storage_state_stored,
			ExpiresAt:    computeExpiresAt(spec.GetRetention()),
		},
	}

	// Set audit fields (created_by, created_at, etc.)
	if err := steps.SetAuditFieldsForCreate(artifact); err != nil {
		log.Error().Err(err).Msg("Failed to set audit fields on artifact")
	}

	// --- Persist metadata ---

	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_artifact, artifactID, artifact); err != nil {
		log.Error().Err(err).Str("artifact_id", artifactID).Msg("Failed to persist artifact metadata")
		return nil, status.Errorf(codes.Internal, "failed to persist artifact: %v", err)
	}

	log.Info().
		Str("artifact_id", artifactID).
		Str("content_hash", contentHash).
		Int64("size_bytes", int64(len(content))).
		Msg("Artifact created successfully")

	return artifact, nil
}

// deriveOrgFromSource resolves the org from the execution that produced this
// artifact. All Stigmer API resources share the same wire layout for metadata
// (field 3 = ApiResourceMetadata), so we use Artifact as a lightweight proxy
// to read the metadata.org field from any resource type without importing
// execution-specific proto packages.
// Falls back to empty string for OSS single-user setups.
func deriveOrgFromSource(ctx context.Context, s storelib.Store, source *artifactv1.ArtifactSource) string {
	lookups := []struct {
		id   string
		kind apiresourcekind.ApiResourceKind
	}{
		{source.GetWorkflowExecutionId(), apiresourcekind.ApiResourceKind_workflow_execution},
		{source.GetAgentExecutionId(), apiresourcekind.ApiResourceKind_agent_execution},
	}

	for _, l := range lookups {
		if l.id == "" {
			continue
		}
		var proxy artifactv1.Artifact
		if err := s.GetResource(ctx, l.kind, l.id, &proxy); err == nil {
			if m := proxy.GetMetadata(); m != nil && m.GetOrg() != "" {
				return m.GetOrg()
			}
		}
	}

	return ""
}

func computeExpiresAt(retention *artifactv1.RetentionPolicy) string {
	ttlDays := int32(defaultTTLDays)
	if retention != nil {
		ttlDays = retention.GetTtlDays()
	}

	switch {
	case ttlDays == permanentTTLMarker:
		return "" // never expires
	case ttlDays <= 0:
		ttlDays = int32(defaultTTLDays)
	}

	return time.Now().UTC().AddDate(0, 0, int(ttlDays)).Format(time.RFC3339)
}
