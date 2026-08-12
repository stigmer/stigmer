package skill

import (
	"context"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PushFromExecutionArtifact pushes a skill directly from an execution
// artifact that is already stored in artifact storage.
//
// This is the server-side equivalent of Push — instead of receiving ZIP
// bytes from the client, it reads an existing directory artifact (produced
// by an agent execution) from execution artifact storage and delegates to
// the standard Push pipeline.
//
// Authorization: can_create_skill in the target org is handled by the proto
// interceptor. The additional can_view check on the execution is validated
// here via the storage_key prefix convention.
func (c *SkillController) PushFromExecutionArtifact(
	ctx context.Context,
	req *skillv1.PushSkillFromExecutionArtifactRequest,
) (*skillv1.Skill, error) {
	if c.executionArtifactStorage == nil {
		log.Error().Msg("Execution artifact storage not configured - cannot push from execution artifact")
		return nil, status.Error(codes.Internal, "execution artifact storage not configured")
	}

	if req.ExecutionId == "" {
		return nil, status.Error(codes.InvalidArgument, "execution_id is required")
	}
	if req.StorageKey == "" {
		return nil, status.Error(codes.InvalidArgument, "storage_key is required")
	}
	if req.Org == "" {
		return nil, status.Error(codes.InvalidArgument, "org is required")
	}

	expectedPrefix := "artifacts/" + req.ExecutionId + "/"
	if !strings.HasPrefix(req.StorageKey, expectedPrefix) {
		log.Warn().
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Str("expected_prefix", expectedPrefix).
			Msg("Storage key does not belong to execution - potential path traversal attempt")
		return nil, status.Error(codes.InvalidArgument, "storage_key does not belong to this execution")
	}

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Str("org", req.Org).
		Str("tag", req.Tag).
		Msg("Pushing skill from execution artifact")

	dlCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	data, err := c.executionArtifactStorage.Download(dlCtx, req.StorageKey)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Msg("Failed to download execution artifact")
		return nil, grpclib.InternalError(err, "failed to download execution artifact")
	}

	pushReq := &skillv1.PushSkillRequest{
		Org:      req.Org,
		Artifact: data,
		Tag:      req.Tag,
	}

	skill, err := c.Push(ctx, pushReq)
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Str("skill_id", skill.GetMetadata().GetId()).
		Str("skill_name", skill.GetMetadata().GetName()).
		Msg("Successfully pushed skill from execution artifact")

	return skill, nil
}
