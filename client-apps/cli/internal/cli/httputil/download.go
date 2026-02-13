// Package httputil provides HTTP utilities for the CLI.
package httputil

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
)

// DownloadOptions contains options for downloading a file.
type DownloadOptions struct {
	// URL is the source URL to download from.
	URL string

	// DestPath is the destination file path.
	DestPath string

	// OnProgress is called with bytes downloaded so far.
	// Can be nil if progress tracking is not needed.
	OnProgress func(downloaded, total int64)

	// Timeout for the HTTP request. Default: 10 minutes.
	Timeout time.Duration
}

// DownloadFile downloads a file from a URL to the specified path.
// It handles large files efficiently by streaming the response body.
//
// Returns the number of bytes written and any error.
func DownloadFile(opts *DownloadOptions) (int64, error) {
	if opts == nil {
		return 0, errors.New("download options cannot be nil")
	}
	if opts.URL == "" {
		return 0, errors.New("URL cannot be empty")
	}
	if opts.DestPath == "" {
		return 0, errors.New("destination path cannot be empty")
	}

	// Apply timeout default
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 10 * time.Minute
	}

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: timeout,
	}

	// Make request
	resp, err := client.Get(opts.URL)
	if err != nil {
		return 0, errors.Wrap(err, "HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(opts.DestPath), 0755); err != nil {
		return 0, errors.Wrap(err, "failed to create directory")
	}

	// Create destination file
	out, err := os.Create(opts.DestPath)
	if err != nil {
		return 0, errors.Wrap(err, "failed to create file")
	}
	defer out.Close()

	// Copy with optional progress tracking
	var written int64
	if opts.OnProgress != nil {
		written, err = copyWithProgress(out, resp.Body, resp.ContentLength, opts.OnProgress)
	} else {
		written, err = io.Copy(out, resp.Body)
	}

	if err != nil {
		return written, errors.Wrap(err, "failed to write file")
	}

	return written, nil
}

// copyWithProgress copies from src to dst while tracking progress.
func copyWithProgress(dst io.Writer, src io.Reader, total int64, onProgress func(downloaded, total int64)) (int64, error) {
	buf := make([]byte, 32*1024) // 32KB buffer
	var written int64

	for {
		nr, err := src.Read(buf)
		if nr > 0 {
			nw, err := dst.Write(buf[0:nr])
			if nw > 0 {
				written += int64(nw)
				onProgress(written, total)
			}
			if err != nil {
				return written, err
			}
			if nr != nw {
				return written, io.ErrShortWrite
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return written, err
		}
	}

	return written, nil
}

// FormatBytes formats bytes as a human-readable string.
func FormatBytes(bytes int64) string {
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
