package embedded

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// EnsureBinariesExtracted ensures all embedded binaries are extracted to the bin directory
// This should be called on daemon start before attempting to use any binaries
//
// NOTE: As of Docker-based architecture, no binaries are embedded anymore.
// All platforms (darwin/arm64, darwin/amd64, linux/amd64) use Docker images for agent-runner.
// This function is kept for backward compatibility and graceful migration.
func EnsureBinariesExtracted(dataDir string) error {
	binDir := filepath.Join(dataDir, "bin")
	
	// Check if extraction is needed
	needsExtraction, err := needsExtraction(binDir)
	if err != nil {
		return errors.Wrap(err, "failed to check extraction status")
	}
	
	if !needsExtraction {
		log.Debug().Msg("Binaries already extracted, skipping extraction")
		return nil
	}
	
	// Log version information if doing fresh extraction
	currentVersion := GetBuildVersion()
	if extractedVersion, _ := readVersionFile(binDir); extractedVersion != "" {
		log.Info().
			Str("extracted", extractedVersion).
			Str("current", currentVersion).
			Msg("Version mismatch detected, re-extracting binaries")
	} else {
		log.Info().
			Str("version", currentVersion).
			Msg("First run detected - agent-runner will be pulled from Docker registry")
	}
	
	// Clean slate: remove old binaries if they exist
	if err := os.RemoveAll(binDir); err != nil && !os.IsNotExist(err) {
		return errors.Wrap(err, "failed to remove old binaries")
	}
	
	// Create bin directory
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create bin directory")
	}
	
	// Extract agent-runner (will be nil for all platforms now - Docker-based)
	log.Debug().Msg("Checking for embedded agent-runner (Docker-based architecture)...")
	if err := extractAgentRunner(binDir); err != nil {
		return errors.Wrap(err, "failed to extract agent-runner")
	}
	
	// Write version marker
	if err := writeVersionFile(binDir, currentVersion); err != nil {
		return errors.Wrap(err, "failed to write version file")
	}
	
	log.Info().
		Str("version", currentVersion).
		Str("location", binDir).
		Msg("Binary extraction check complete - using Docker-based agent-runner")
	
	return nil
}

// extractAgentRunner extracts the agent-runner binary to the bin directory
// Note: As of Docker-based architecture, this always returns nil (no embedded binaries).
// The daemon will pull the agent-runner Docker image from ghcr.io/stigmer/agent-runner on first start.
func extractAgentRunner(binDir string) error {
	data, err := GetAgentRunnerBinary()
	if err != nil {
		return err
	}
	
	// If data is nil, it means the binary is not embedded (Docker-based architecture for all platforms)
	// Skip extraction gracefully - the daemon will pull the Docker image on first use
	if data == nil || len(data) == 0 {
		log.Debug().Msg("Agent-runner not embedded (Docker-based), will be pulled from ghcr.io on daemon start")
		return nil
	}
	
	destPath := filepath.Join(binDir, "agent-runner")
	return extractBinary(destPath, data)
}

// extractBinary writes a binary to disk and makes it executable
func extractBinary(destPath string, data []byte) error {
	// Write binary
	if err := os.WriteFile(destPath, data, 0755); err != nil {
		return errors.Wrapf(err, "failed to write binary to %s", destPath)
	}
	
	// Ensure executable permissions
	if err := os.Chmod(destPath, 0755); err != nil {
		return errors.Wrapf(err, "failed to set executable permissions on %s", destPath)
	}
	
	log.Debug().
		Str("path", destPath).
		Int("size_bytes", len(data)).
		Msg("Extracted binary")
	
	return nil
}

// extractTarball extracts a tar.gz archive to a destination directory
func extractTarball(destDir string, data []byte) error {
	// Create destination directory
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return errors.Wrapf(err, "failed to create directory %s", destDir)
	}
	
	// Create gzip reader
	gzipReader, err := gzip.NewReader(io.NopCloser(io.Reader(newBytesReader(data))))
	if err != nil {
		return errors.Wrap(err, "failed to create gzip reader")
	}
	defer gzipReader.Close()
	
	// Create tar reader
	tarReader := tar.NewReader(gzipReader)
	
	// Extract all files
	fileCount := 0
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break // End of archive
		}
		if err != nil {
			return errors.Wrap(err, "failed to read tar header")
		}
		
		// Construct destination path
		targetPath := filepath.Join(destDir, header.Name)
		
		// Ensure target path is within destDir (prevent path traversal)
		if !filepath.HasPrefix(targetPath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("invalid file path in tarball: %s", header.Name)
		}
		
		switch header.Typeflag {
		case tar.TypeDir:
			// Create directory
			if err := os.MkdirAll(targetPath, os.FileMode(header.Mode)); err != nil {
				return errors.Wrapf(err, "failed to create directory %s", targetPath)
			}
			
		case tar.TypeReg:
			// Create parent directory if needed
			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				return errors.Wrapf(err, "failed to create parent directory for %s", targetPath)
			}
			
			// Create file
			outFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return errors.Wrapf(err, "failed to create file %s", targetPath)
			}
			
			// Copy file contents
			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return errors.Wrapf(err, "failed to write file %s", targetPath)
			}
			
			outFile.Close()
			fileCount++
			
		case tar.TypeSymlink:
			// Create symlink
			if err := os.Symlink(header.Linkname, targetPath); err != nil {
				return errors.Wrapf(err, "failed to create symlink %s -> %s", targetPath, header.Linkname)
			}
			
		default:
			log.Warn().
				Str("name", header.Name).
				Int("type", int(header.Typeflag)).
				Msg("Skipping unsupported tar entry type")
		}
	}
	
	log.Debug().
		Str("path", destDir).
		Int("file_count", fileCount).
		Int("size_bytes", len(data)).
		Msg("Extracted tarball")
	
	return nil
}

// bytesReader wraps a byte slice to implement io.Reader
type bytesReader struct {
	data []byte
	pos  int
}

func newBytesReader(data []byte) *bytesReader {
	return &bytesReader{data: data}
}

func (r *bytesReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
