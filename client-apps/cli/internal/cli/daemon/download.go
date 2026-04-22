package daemon

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

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

// DownloadMCPServerBinary downloads the mcp-server-stigmer binary from the
// latest GitHub release to ~/.stigmer/bin/ and returns the installed path.
//
// It queries the GitHub releases API to find the most recent release that
// includes mcp-server-stigmer assets, then downloads the platform-appropriate
// archive and extracts the binary.
func DownloadMCPServerBinary() (string, error) {
	version, err := getLatestMCPServerVersion()
	if err != nil {
		return "", errors.Wrap(err, "failed to determine latest mcp-server version")
	}

	log.Info().Str("version", version).Msg("Downloading mcp-server-stigmer from GitHub releases")

	goos := runtime.GOOS
	goarch := runtime.GOARCH

	filename := fmt.Sprintf("mcp-server-stigmer-%s-%s-%s.tar.gz", version, goos, goarch)
	url := fmt.Sprintf("%s/%s/releases/download/%s/%s", githubBaseURL, githubRepo, version, filename)

	log.Debug().Str("url", url).Msg("Downloading mcp-server-stigmer")

	tmpDir, err := os.MkdirTemp("", "stigmer-mcp-download-*")
	if err != nil {
		return "", errors.Wrap(err, "failed to create temp directory")
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, filename)
	if err := downloadFile(url, archivePath); err != nil {
		return "", errors.Wrapf(err, "failed to download %s", filename)
	}

	extractedPath := filepath.Join(tmpDir, "mcp-server-stigmer")
	if err := extractBinaryFromTarGz(archivePath, "mcp-server-stigmer", extractedPath); err != nil {
		return "", errors.Wrap(err, "failed to extract binary")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to determine home directory")
	}

	installDir := filepath.Join(home, ".stigmer", "bin")
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return "", errors.Wrap(err, "failed to create install directory")
	}

	installPath := filepath.Join(installDir, "mcp-server-stigmer")
	if err := copyFile(extractedPath, installPath); err != nil {
		return "", errors.Wrap(err, "failed to install binary")
	}

	if err := os.Chmod(installPath, 0755); err != nil {
		return "", errors.Wrap(err, "failed to make binary executable")
	}

	log.Info().Str("path", installPath).Str("version", version).Msg("Installed mcp-server-stigmer")
	return installPath, nil
}

// getLatestMCPServerVersion queries the GitHub releases API and returns the
// tag name of the most recent release that contains mcp-server-stigmer assets.
func getLatestMCPServerVersion() (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=20", githubRepo)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", errors.Wrap(err, "GitHub API request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub API returned %s", resp.Status)
	}

	var releases []struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name string `json:"name"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return "", errors.Wrap(err, "failed to parse GitHub releases response")
	}

	for _, r := range releases {
		for _, a := range r.Assets {
			if strings.HasPrefix(a.Name, "mcp-server-stigmer-") {
				return r.TagName, nil
			}
		}
	}

	return "", fmt.Errorf("no GitHub release found with mcp-server-stigmer assets")
}

// extractBinaryFromTarGz extracts a single named binary from a .tar.gz archive.
func extractBinaryFromTarGz(archivePath, binaryName, destPath string) error {
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
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		if header.Name == binaryName || filepath.Base(header.Name) == binaryName {
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

	return fmt.Errorf("%s not found in archive", binaryName)
}

// downloadRunnerBinary downloads the runner binary from GitHub releases
// matching the CLI version for compatibility
func downloadRunnerBinary(dataDir string, version string) (string, error) {
	log.Info().Str("version", version).Msg("Downloading agent-runner from GitHub releases")

	// Determine platform
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	// Construct download URL for agent-runner binary
	// Format: https://github.com/stigmer/stigmer/releases/download/v1.0.0/agent-runner-v1.0.0-darwin-arm64
	filename := fmt.Sprintf("agent-runner-%s-%s-%s", version, goos, goarch)
	url := fmt.Sprintf("%s/%s/releases/download/%s/%s", githubBaseURL, githubRepo, version, filename)

	log.Debug().Str("url", url).Msg("Downloading agent-runner from GitHub")

	// Ensure bin directory exists
	binDir := filepath.Join(dataDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return "", errors.Wrap(err, "failed to create bin directory")
	}

	// Download directly to destination
	destPath := filepath.Join(binDir, "agent-runner")

	if err := downloadFile(url, destPath); err != nil {
		return "", errors.Wrap(err, "failed to download agent-runner binary")
	}

	// Make executable
	if err := os.Chmod(destPath, 0755); err != nil {
		return "", errors.Wrap(err, "failed to make binary executable")
	}

	log.Info().Str("path", destPath).Msg("Successfully downloaded and installed agent-runner")
	return destPath, nil
}
