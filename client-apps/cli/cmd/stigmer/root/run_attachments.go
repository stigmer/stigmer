package root

import (
	"context"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// AttachmentResult holds the split results from processing --attach paths.
//
// When a workspace root is provided, files inside the workspace are recorded as
// workspace-relative references (no upload, no injection). Files outside the
// workspace go through the normal upload flow and become Attachment protos.
type AttachmentResult struct {
	Attachments       []*agentexecutionv1.Attachment
	WorkspaceFileRefs []string
}

// attachmentUploader abstracts the UploadAttachment RPC for testability.
type attachmentUploader interface {
	UploadAttachment(ctx context.Context, input *agentexecutionv1.UploadAttachmentRequest) (*agentexecutionv1.UploadAttachmentResponse, error)
}

// AttachmentProcessor handles file attachments for the run command.
// All files are uploaded via the uploadAttachment RPC and referenced by storage_key.
// This ensures consistent behavior regardless of file size and avoids Temporal
// payload limits (2MB).
type AttachmentProcessor struct {
	uploader attachmentUploader
}

// NewAttachmentProcessor creates a new attachment processor.
func NewAttachmentProcessor(client *stigmer.Client) *AttachmentProcessor {
	return &AttachmentProcessor{uploader: client.AgentExecution}
}

// ProcessFiles converts file paths to Attachment protos or workspace file references.
//
// When workspaceRoots is non-empty (local workspace), each path is checked for
// containment inside any workspace root (first match wins):
//   - Inside a workspace root: recorded as a workspace-relative path in
//     WorkspaceFileRefs. No upload, no injection -- the agent reads directly
//     from the workspace.
//   - Outside all workspace roots: uploaded via the normal attachment flow.
//
// When workspaceRoots is empty, all files go through the upload flow (existing behavior).
func (p *AttachmentProcessor) ProcessFiles(paths []string, workspaceRoots []string) (*AttachmentResult, error) {
	if len(paths) == 0 {
		return &AttachmentResult{}, nil
	}

	result := &AttachmentResult{
		Attachments:       make([]*agentexecutionv1.Attachment, 0, len(paths)),
		WorkspaceFileRefs: make([]string, 0),
	}

	for _, path := range paths {
		if matched := p.matchWorkspaceRoot(path, workspaceRoots, result); matched {
			continue
		}

		attachment, err := p.processFile(path)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to process attachment '%s'", path)
		}
		result.Attachments = append(result.Attachments, attachment)
	}

	return result, nil
}

// matchWorkspaceRoot checks whether path is contained in any of the workspace
// roots. On the first match, it appends a workspace-relative reference to
// result and returns true. Returns false if the path is outside all roots
// or if there are no roots to check.
func (p *AttachmentProcessor) matchWorkspaceRoot(path string, roots []string, result *AttachmentResult) bool {
	for _, root := range roots {
		relPath, inside, err := workspaceRelativePath(path, root)
		if err != nil {
			continue
		}
		if inside {
			climsg.Info("Referencing workspace file: %s", relPath)
			result.WorkspaceFileRefs = append(result.WorkspaceFileRefs, relPath)
			return true
		}
	}
	return false
}

// workspaceRelativePath checks whether filePath is inside workspaceRoot.
// Returns the workspace-relative path and true if contained, or ("", false) if not.
//
// Both paths are resolved through EvalSymlinks to prevent symlink escapes,
// then normalized with filepath.Clean before the containment check.
func workspaceRelativePath(filePath, workspaceRoot string) (string, bool, error) {
	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return "", false, errors.Wrap(err, "failed to resolve absolute path")
	}

	evalFile, err := filepath.EvalSymlinks(absFile)
	if err != nil {
		return "", false, errors.Wrap(err, "failed to evaluate symlinks")
	}

	evalRoot, err := filepath.EvalSymlinks(workspaceRoot)
	if err != nil {
		return "", false, errors.Wrap(err, "failed to evaluate workspace symlinks")
	}

	cleanFile := filepath.Clean(evalFile)
	cleanRoot := filepath.Clean(evalRoot)

	rootPrefix := cleanRoot + string(filepath.Separator)
	if !strings.HasPrefix(cleanFile, rootPrefix) && cleanFile != cleanRoot {
		return "", false, nil
	}

	rel, err := filepath.Rel(cleanRoot, cleanFile)
	if err != nil {
		return "", false, nil
	}

	return filepath.ToSlash(rel), true, nil
}

// processFile validates a file and uploads it, returning an Attachment proto.
func (p *AttachmentProcessor) processFile(path string) (*agentexecutionv1.Attachment, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", path)
		}
		return nil, errors.Wrap(err, "failed to stat file")
	}

	if info.IsDir() {
		return p.processDirectory(path)
	}

	filename := filepath.Base(path)
	contentType := detectContentType(filename)

	return p.uploadFile(path, filename, contentType, info.Size())
}

// processDirectory zips a directory and uploads it as a single attachment.
// The resulting Attachment has extract=true so the agent runner extracts
// the archive at mount_path instead of writing it as a single file.
func (p *AttachmentProcessor) processDirectory(path string) (*agentexecutionv1.Attachment, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve directory path")
	}
	dirname := filepath.Base(absPath)

	zipBytes, fileCount, originalSize, err := zipDirectory(absPath)
	if err != nil {
		return nil, err
	}

	zipSize := int64(len(zipBytes))

	climsg.Info("Zipping directory: %s/ (%d files, %s -> %s compressed)",
		dirname, fileCount, formatFileSize(originalSize), formatFileSize(zipSize))

	if zipSize > maxAttachmentSize {
		return nil, fmt.Errorf(
			"zipped directory too large (%s). Maximum attachment size is %s",
			formatFileSize(zipSize), formatFileSize(maxAttachmentSize))
	}

	filename := dirname + ".zip"
	attachment, err := p.uploadBytes(zipBytes, filename, "application/zip")
	if err != nil {
		return nil, err
	}

	attachment.Extract = true
	attachment.MountPath = fmt.Sprintf("inputs/%s/", dirname)
	attachment.LocalPath = absPath
	return attachment, nil
}

// uploadFile reads a file from disk and uploads it via the UploadAttachment RPC.
func (p *AttachmentProcessor) uploadFile(path, filename, contentType string, size int64) (*agentexecutionv1.Attachment, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve absolute path")
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read file")
	}

	climsg.Info("Uploading %s (%s)...", filename, formatFileSize(size))

	attachment, err := p.uploadBytes(content, filename, contentType)
	if err != nil {
		return nil, err
	}
	attachment.LocalPath = absPath
	return attachment, nil
}

// uploadBytes uploads raw bytes via the UploadAttachment RPC and returns an Attachment.
func (p *AttachmentProcessor) uploadBytes(content []byte, filename, contentType string) (*agentexecutionv1.Attachment, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	resp, err := p.uploader.UploadAttachment(ctx, &agentexecutionv1.UploadAttachmentRequest{
		Filename:    filename,
		Content:     content,
		ContentType: contentType,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload attachment")
	}

	climsg.Success("Uploaded %s", filename)

	return &agentexecutionv1.Attachment{
		Filename:    filename,
		StorageKey:  resp.GetStorageKey(),
		ContentType: contentType,
	}, nil
}

// detectContentType detects the MIME type from a filename extension.
func detectContentType(filename string) string {
	ext := filepath.Ext(filename)
	if ext == "" {
		return "application/octet-stream"
	}

	mimeType := mime.TypeByExtension(ext)
	if mimeType != "" {
		return mimeType
	}

	switch ext {
	case ".md", ".markdown":
		return "text/markdown"
	case ".yaml", ".yml":
		return "application/x-yaml"
	case ".toml":
		return "application/toml"
	case ".csv":
		return "text/csv"
	case ".tsv":
		return "text/tab-separated-values"
	case ".log":
		return "text/plain"
	case ".sql":
		return "application/sql"
	case ".parquet":
		return "application/vnd.apache.parquet"
	case ".avro":
		return "application/avro"
	default:
		return "application/octet-stream"
	}
}

// formatFileSize formats a file size as a human-readable string.
func formatFileSize(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/GB)
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/MB)
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/KB)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
