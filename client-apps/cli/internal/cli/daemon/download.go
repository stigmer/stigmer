package daemon

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

const (
	githubRepo    = "stigmer/stigmer"
	githubBaseURL = "https://github.com"
)

// downloadServerBinary downloads the stigmer-server binary from GitHub releases
func downloadServerBinary(version string) (string, error) {
	log.Info().Str("version", version).Msg("Downloading stigmer-server from GitHub releases")

	// Determine platform
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	
	// Normalize architecture names to match GoReleaser
	arch := goarch
	switch goarch {
	case "amd64":
		arch = "x86_64"
	case "arm64":
		arch = "arm64"
	case "386":
		arch = "i386"
	}
	
	// Normalize OS name
	osName := goos
	switch goos {
	case "darwin":
		osName = "Darwin"
	case "linux":
		osName = "Linux"
	case "windows":
		osName = "Windows"
	}

	// Construct download URL
	filename := fmt.Sprintf("stigmer_%s_%s_%s.tar.gz", version, osName, arch)
	if goos == "windows" {
		filename = fmt.Sprintf("stigmer_%s_%s_%s.zip", version, osName, arch)
	}
	
	url := fmt.Sprintf("%s/%s/releases/download/%s/%s", githubBaseURL, githubRepo, version, filename)
	
	log.Debug().Str("url", url).Msg("Downloading from GitHub")

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "stigmer-download-*")
	if err != nil {
		return "", errors.Wrap(err, "failed to create temp directory")
	}
	defer os.RemoveAll(tmpDir)

	// Download archive
	archivePath := filepath.Join(tmpDir, filename)
	if err := downloadFile(url, archivePath); err != nil {
		return "", errors.Wrap(err, "failed to download archive")
	}

	// Extract stigmer-server binary
	extractedPath := filepath.Join(tmpDir, "stigmer-server")
	if goos == "windows" {
		extractedPath += ".exe"
	}
	
	if err := extractServerBinary(archivePath, extractedPath, goos); err != nil {
		return "", errors.Wrap(err, "failed to extract binary")
	}

	// Install to ~/.stigmer/bin/
	installDir := filepath.Join(os.Getenv("HOME"), ".stigmer", "bin")
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return "", errors.Wrap(err, "failed to create install directory")
	}

	installPath := filepath.Join(installDir, "stigmer-server")
	if goos == "windows" {
		installPath += ".exe"
	}

	// Copy binary to install location
	if err := copyFile(extractedPath, installPath); err != nil {
		return "", errors.Wrap(err, "failed to install binary")
	}

	// Make executable
	if err := os.Chmod(installPath, 0755); err != nil {
		return "", errors.Wrap(err, "failed to make binary executable")
	}

	log.Info().Str("path", installPath).Msg("Successfully downloaded and installed stigmer-server")
	return installPath, nil
}

// downloadFile downloads a file from a URL
func downloadFile(url, dest string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %s", resp.Status)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// extractServerBinary extracts stigmer-server from the archive
func extractServerBinary(archivePath, destPath, goos string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzr, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	binaryName := "stigmer-server"
	if goos == "windows" {
		binaryName = "stigmer-server.exe"
	}

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		if header.Name == binaryName {
			out, err := os.Create(destPath)
			if err != nil {
				return err
			}
			defer out.Close()

			if _, err := io.Copy(out, tr); err != nil {
				return err
			}

			return nil
		}
	}

	return errors.New("stigmer-server not found in archive")
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

// getLatestVersion fetches the latest release version from GitHub
func getLatestVersion() (string, error) {
	// For now, return a default version
	// In production, this should query GitHub API
	return "v0.1.0", nil
}
