package temporal

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// downloadBinary downloads the Temporal CLI binary from GitHub releases
func (m *Manager) downloadBinary() error {
	// Detect OS and architecture
	goos := runtime.GOOS     // darwin, linux, windows
	goarch := runtime.GOARCH // amd64, arm64
	
	// Construct download URL
	// https://github.com/temporalio/cli/releases/download/v1.25.1/temporal_cli_1.25.1_darwin_arm64.tar.gz
	baseURL := "https://github.com/temporalio/cli/releases/download"
	archiveName := fmt.Sprintf("temporal_cli_%s_%s_%s.tar.gz", m.version, goos, goarch)
	downloadURL := fmt.Sprintf("%s/v%s/%s", baseURL, m.version, archiveName)
	
	log.Debug().
		Str("url", downloadURL).
		Str("os", goos).
		Str("arch", goarch).
		Msg("Downloading Temporal CLI")
	
	// Create temporary file for download
	tmpFile, err := os.CreateTemp("", "temporal-*.tar.gz")
	if err != nil {
		return errors.Wrap(err, "failed to create temp file")
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()
	
	// Download the archive
	resp, err := http.Get(downloadURL)
	if err != nil {
		return errors.Wrap(err, "failed to download Temporal CLI")
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download Temporal CLI: HTTP %d", resp.StatusCode)
	}
	
	// Copy response to temp file
	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		return errors.Wrap(err, "failed to save downloaded file")
	}
	
	// Seek back to start for extraction
	if _, err := tmpFile.Seek(0, 0); err != nil {
		return errors.Wrap(err, "failed to seek temp file")
	}
	
	// Extract the binary
	if err := m.extractBinary(tmpFile); err != nil {
		return errors.Wrap(err, "failed to extract binary")
	}
	
	return nil
}

// extractBinary extracts the temporal binary from the tar.gz archive
func (m *Manager) extractBinary(tarGzFile *os.File) error {
	// Create gzip reader
	gzr, err := gzip.NewReader(tarGzFile)
	if err != nil {
		return errors.Wrap(err, "failed to create gzip reader")
	}
	defer gzr.Close()
	
	// Create tar reader
	tr := tar.NewReader(gzr)
	
	// Ensure bin directory exists
	binDir := filepath.Dir(m.binPath)
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create bin directory")
	}
	
	// Extract the "temporal" binary
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break // End of archive
		}
		if err != nil {
			return errors.Wrap(err, "failed to read tar header")
		}
		
		// Look for the "temporal" binary
		if header.Name == "temporal" || filepath.Base(header.Name) == "temporal" {
			// Create the binary file
			outFile, err := os.OpenFile(m.binPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				return errors.Wrap(err, "failed to create binary file")
			}
			defer outFile.Close()
			
			// Copy binary content
			if _, err := io.Copy(outFile, tr); err != nil {
				return errors.Wrap(err, "failed to write binary")
			}
			
			log.Info().Str("path", m.binPath).Msg("Extracted temporal binary")
			return nil
		}
	}
	
	return errors.New("temporal binary not found in archive")
}
