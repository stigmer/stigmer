package agentexecution

import (
	"context"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UploadAttachment uploads a file attachment to artifact storage.
//
// This endpoint allows CLI and other clients to pre-upload large files (>4MB)
// to artifact storage before creating an agent execution. The returned storage_key
// can then be used in the Attachment message when creating the execution.
//
// ## Authorization
//
// This endpoint does not require authorization. The storage_key returned acts
// as a capability token - knowing the key grants access to the content.
//
// ## Storage Path
//
// Files are stored at: attachments/{ulid}/{filename}
// The ULID ensures unique paths and enables future cleanup policies.
//
// ## Use Cases
//
// - CLI uploading files (>4MB) before agent execution
// - Pre-uploading datasets for agent processing
// - Uploading binary files that cannot be embedded inline
func (c *AgentExecutionController) UploadAttachment(ctx context.Context, req *agentexecutionv1.UploadAttachmentRequest) (*agentexecutionv1.UploadAttachmentResponse, error) {
	// Check artifact storage is configured
	if c.artifactStorage == nil {
		log.Error().Msg("Artifact storage not configured - cannot upload attachment")
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	// Validate request fields (buf validate handles min_len and required)
	if req.Filename == "" {
		return nil, status.Error(codes.InvalidArgument, "filename is required")
	}
	// The filename is interpolated into the storage key and, downstream, into a
	// filesystem path. Reject anything that could smuggle path structure so a
	// crafted name can never escape the artifact root. This mirrors the proto's
	// buf.validate constraint; keeping it here means a bypassed constraint still
	// fails closed at the service boundary.
	if err := validateAttachmentFilename(req.Filename); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	if len(req.Content) == 0 {
		return nil, status.Error(codes.InvalidArgument, "content is required")
	}

	// Generate unique identifier for this upload
	uploadID := ulid.Make().String()

	// Determine content type
	contentType := req.ContentType
	if contentType == "" {
		// Guess from filename extension
		ext := filepath.Ext(req.Filename)
		if ext != "" {
			contentType = mime.TypeByExtension(ext)
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
	}

	// Build storage key: attachments/{ulid}/{filename}
	storageKey := fmt.Sprintf("attachments/%s/%s", uploadID, req.Filename)

	log.Info().
		Str("storage_key", storageKey).
		Str("filename", req.Filename).
		Str("content_type", contentType).
		Int("size_bytes", len(req.Content)).
		Msg("Uploading attachment to artifact storage")

	// Upload to storage
	uploadCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	if err := c.artifactStorage.Upload(uploadCtx, storageKey, req.Content, contentType); err != nil {
		log.Error().
			Err(err).
			Str("storage_key", storageKey).
			Msg("Failed to upload attachment to storage")
		return nil, status.Errorf(codes.Internal, "failed to upload attachment: %v", err)
	}

	log.Info().
		Str("storage_key", storageKey).
		Str("filename", req.Filename).
		Int("size_bytes", len(req.Content)).
		Msg("Successfully uploaded attachment to storage")

	return &agentexecutionv1.UploadAttachmentResponse{
		StorageKey: storageKey,
	}, nil
}

// validateAttachmentFilename enforces that a filename is a single bare path
// component: no directory separators (either flavor), no `.`/`..` traversal
// segments, and no NUL byte. The filename becomes part of the storage key and,
// on the local backend, part of an on-disk path — so a name carrying path
// structure is a directory-traversal vector, not a display quirk.
func validateAttachmentFilename(name string) error {
	if strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("filename %q must not contain path separators; send a bare filename such as \"report.pdf\"", name)
	}
	if strings.ContainsRune(name, 0) {
		return fmt.Errorf("filename must not contain NUL bytes")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("filename %q must be a bare filename, not a traversal segment", name)
	}
	return nil
}
