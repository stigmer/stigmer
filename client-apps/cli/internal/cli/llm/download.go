package llm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

const (
	// Ollama release download URLs (implementation detail - user never sees this)
	downloadBaseURL = "https://github.com/ollama/ollama/releases/latest/download"
)

// downloadBinary downloads the LLM binary for the current platform
func downloadBinary(ctx context.Context, destPath string, opts *SetupOptions) error {
	// Determine platform and architecture
	downloadURL, err := getDownloadURL()
	if err != nil {
		return err
	}

	log.Info().Str("url", downloadURL).Msg("Downloading LLM binary")

	// Create temp file
	tmpFile, err := os.CreateTemp("", "llm-download-*")
	if err != nil {
		return errors.Wrap(err, "failed to create temp file")
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// Download with progress
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return errors.Wrap(err, "failed to create request")
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return errors.Wrap(err, "failed to download binary")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %s", resp.Status)
	}

	// Get total size for progress
	totalSize := resp.ContentLength

	// Create progress reader wrapper if progress display is available
	var reader io.Reader = resp.Body
	if opts.Progress != nil && totalSize > 0 {
		reader = &progressReader{
			reader:    resp.Body,
			total:     totalSize,
			progress:  opts.Progress,
			lastPrint: 0,
		}
	}

	// Copy to temp file
	if _, err := io.Copy(tmpFile, reader); err != nil {
		return errors.Wrap(err, "failed to write binary")
	}

	tmpFile.Close()

	// Ensure destination directory exists
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create destination directory")
	}

	// Move to final location
	if err := os.Rename(tmpFile.Name(), destPath); err != nil {
		// Fallback: copy if rename fails (cross-device)
		if err := copyFile(tmpFile.Name(), destPath); err != nil {
			return errors.Wrap(err, "failed to move binary to destination")
		}
	}

	// Make executable
	if err := os.Chmod(destPath, 0755); err != nil {
		return errors.Wrap(err, "failed to make binary executable")
	}

	log.Info().Str("path", destPath).Msg("LLM binary downloaded successfully")
	return nil
}

// getDownloadURL returns the download URL for the current platform
func getDownloadURL() (string, error) {
	var filename string

	switch runtime.GOOS {
	case "darwin":
		// macOS (universal binary)
		filename = "ollama-darwin"
	case "linux":
		// Linux
		if runtime.GOARCH == "amd64" {
			filename = "ollama-linux-amd64"
		} else if runtime.GOARCH == "arm64" {
			filename = "ollama-linux-arm64"
		} else {
			return "", fmt.Errorf("unsupported Linux architecture: %s", runtime.GOARCH)
		}
	case "windows":
		// Windows
		filename = "ollama-windows-amd64.exe"
	default:
		return "", fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	return fmt.Sprintf("%s/%s", downloadBaseURL, filename), nil
}

// progressReader wraps an io.Reader to track download progress
type progressReader struct {
	reader    io.Reader
	total     int64
	current   int64
	progress  *cliprint.ProgressDisplay
	lastPrint int // Last printed percentage
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.current += int64(n)

	if pr.progress != nil && pr.total > 0 {
		percentage := int(float64(pr.current) / float64(pr.total) * 100)

		// Only update progress if percentage changed significantly (every 10%)
		if percentage-pr.lastPrint >= 10 || percentage == 100 {
			pr.lastPrint = percentage
			pr.progress.SetPhase(cliprint.PhaseInstalling,
				fmt.Sprintf("Downloading local LLM: %d%% (%s / %s)",
					percentage,
					formatBytes(pr.current),
					formatBytes(pr.total)))
		}
	}

	return n, err
}

// formatBytes formats bytes into human-readable format
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
