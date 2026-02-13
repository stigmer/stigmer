package root

import (
	"context"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/grpc"
)

// AttachmentProcessor handles file attachments for the run command.
// All files are uploaded via the uploadAttachment RPC and referenced by storage_key.
// This ensures consistent behavior regardless of file size and avoids Temporal
// payload limits (2MB).
type AttachmentProcessor struct {
	conn grpc.ClientConnInterface
}

// NewAttachmentProcessor creates a new attachment processor.
func NewAttachmentProcessor(conn grpc.ClientConnInterface) *AttachmentProcessor {
	return &AttachmentProcessor{conn: conn}
}

// ProcessFiles converts file paths to Attachment protos.
// Each file is uploaded via the uploadAttachment RPC and an Attachment with
// storage_key is returned.
func (p *AttachmentProcessor) ProcessFiles(paths []string) ([]*agentexecutionv1.Attachment, error) {
	if len(paths) == 0 {
		return nil, nil
	}

	attachments := make([]*agentexecutionv1.Attachment, 0, len(paths))

	for _, path := range paths {
		attachment, err := p.processFile(path)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to process attachment '%s'", path)
		}
		attachments = append(attachments, attachment)
	}

	return attachments, nil
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
		return nil, fmt.Errorf("cannot attach directory: %s (only files are supported)", path)
	}

	filename := filepath.Base(path)
	contentType := detectContentType(filename)

	return p.uploadFile(path, filename, contentType, info.Size())
}

// uploadFile uploads a file and creates an Attachment with storage_key.
func (p *AttachmentProcessor) uploadFile(path, filename, contentType string, size int64) (*agentexecutionv1.Attachment, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read file")
	}

	cliprint.PrintInfo("Uploading %s (%s)...", filename, formatFileSize(size))

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(p.conn)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	resp, err := client.UploadAttachment(ctx, &agentexecutionv1.UploadAttachmentRequest{
		Filename:    filename,
		Content:     content,
		ContentType: contentType,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload attachment")
	}

	cliprint.PrintSuccess("Uploaded %s", filename)

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
