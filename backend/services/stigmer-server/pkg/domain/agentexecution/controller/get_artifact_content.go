package agentexecution

import (
	"context"
	"mime"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// DefaultMaxArtifactContentBytes is the default size limit when max_bytes is
// unset (0). The server returns the first 512 KB of the artifact and sets
// truncated=true if the full content exceeds this threshold.
const DefaultMaxArtifactContentBytes int64 = 512 * 1024 // 512 KB

// knownContentTypes supplements Go's mime.TypeByExtension for artifact-relevant
// extensions that are commonly missing from the OS MIME database.
var knownContentTypes = map[string]string{
	".yaml": "text/yaml",
	".yml":  "text/yaml",
	".json": "application/json",
	".md":   "text/markdown",
	".txt":  "text/plain",
	".csv":  "text/csv",
	".xml":  "application/xml",
	".html": "text/html",
	".zip":  "application/zip",
	".tar":  "application/x-tar",
	".gz":   "application/gzip",
	".py":   "text/x-python",
	".go":   "text/x-go",
	".js":   "text/javascript",
	".ts":   "text/typescript",
	".sh":   "text/x-shellscript",
	".toml": "application/toml",
}

// GetArtifactContent reads the raw content of an execution artifact.
//
// Unlike GetArtifactDownloadUrl (which returns a presigned URL for direct
// browser download), this endpoint returns the artifact bytes through the
// Stigmer API. This eliminates CORS concerns for SDK consumers who need to
// read artifact content programmatically — e.g., for YAML parsing, resource
// detection, or in-app preview rendering.
//
// ## Authorization
//
// Authorization (can_view on execution) is handled by the proto authorization
// interceptor via the rpc method options.
//
// ## Security
//
// The storage_key is validated to ensure it belongs to the specified execution.
// Storage keys must start with "artifacts/{execution_id}/" to prevent path
// traversal attacks.
//
// ## Size Limit
//
// Content is truncated to max_bytes (default: 512 KB). The response includes
// total_size_bytes and a truncated flag so callers can decide whether to offer
// a full download via GetArtifactDownloadUrl instead.
func (c *AgentExecutionController) GetArtifactContent(
	ctx context.Context,
	req *agentexecutionv1.GetArtifactContentRequest,
) (*agentexecutionv1.GetArtifactContentResponse, error) {
	if c.artifactStorage == nil {
		log.Error().Msg("Artifact storage not configured - cannot read artifact content")
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	if req.ExecutionId == "" {
		return nil, status.Error(codes.InvalidArgument, "execution_id is required")
	}
	if req.StorageKey == "" {
		return nil, status.Error(codes.InvalidArgument, "storage_key is required")
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

	execution := &agentexecutionv1.AgentExecution{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, req.ExecutionId, execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Msg("Failed to load execution for artifact content")
		return nil, status.Errorf(codes.NotFound, "execution not found: %s", req.ExecutionId)
	}

	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = DefaultMaxArtifactContentBytes
	}

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Int64("max_bytes", maxBytes).
		Msg("Reading artifact content")

	dlCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	data, err := c.artifactStorage.Download(dlCtx, req.StorageKey)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Msg("Failed to download artifact content")
		return nil, status.Errorf(codes.Internal, "failed to read artifact content: %v", err)
	}

	totalSize := int64(len(data))
	truncated := false
	if totalSize > maxBytes {
		data = data[:maxBytes]
		truncated = true
	}

	contentType := detectContentType(req.StorageKey)

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Int64("total_size_bytes", totalSize).
		Int("returned_bytes", len(data)).
		Bool("truncated", truncated).
		Str("content_type", contentType).
		Msg("Successfully read artifact content")

	return &agentexecutionv1.GetArtifactContentResponse{
		Content:        data,
		ContentType:    contentType,
		TotalSizeBytes: totalSize,
		Truncated:      truncated,
	}, nil
}

// detectContentType determines a MIME type from the file extension in a
// storage key. It checks the knownContentTypes table first (for artifact-
// relevant types that the OS MIME database may lack), then falls back to
// Go's mime.TypeByExtension, and finally defaults to application/octet-stream.
func detectContentType(storageKey string) string {
	ext := strings.ToLower(filepath.Ext(storageKey))
	if ext == "" {
		return "application/octet-stream"
	}

	if ct, ok := knownContentTypes[ext]; ok {
		return ct
	}

	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}

	return "application/octet-stream"
}
