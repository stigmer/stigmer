package root

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// downloadExecutionArtifacts downloads artifacts from an execution.
func downloadExecutionArtifacts(executionID string, opts downloadOptions, client *stigmer.Client) error {
	exec, err := execution.GetFromBackend(client, executionID)
	if err != nil {
		return errors.Wrap(err, "failed to get execution")
	}

	// Step 2: Check execution status
	phase := exec.GetStatus().GetPhase()
	if !isCompletedPhase(phase) {
		climsg.Warning("Execution is still %s", formatPhaseForDownload(phase))
		climsg.Info("Artifacts may not be complete until execution finishes.")
		fmt.Println()
	}

	// Step 3: Get artifacts
	artifacts := exec.GetStatus().GetArtifacts()
	if len(artifacts) == 0 {
		fmt.Println()
		climsg.Info("No artifacts found for execution: %s", executionID)
		fmt.Println()
		climsg.Info("Tip: Artifacts are files created by the agent during execution.")
		climsg.Info("Not all agents produce artifacts.")
		fmt.Println()
		return nil
	}

	// Step 4: Filter artifacts if specific one requested
	if opts.ArtifactName != "" {
		artifacts = filterArtifactsByName(artifacts, opts.ArtifactName)
		if len(artifacts) == 0 {
			return fmt.Errorf("artifact not found: %s\n\nUse 'stigmer get execution %s' to see available artifacts", opts.ArtifactName, executionID)
		}
	}

	// Step 5: Create output directory
	if err := os.MkdirAll(opts.OutputDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create output directory")
	}

	// Step 6: Download each artifact
	fmt.Println()
	climsg.Info("Downloading %d artifact(s) to %s...", len(artifacts), opts.OutputDir)
	fmt.Println()

	var downloadedCount int
	for _, artifact := range artifacts {
		if err := downloadSingleArtifact(executionID, artifact, opts.OutputDir, client); err != nil {
			climsg.Error("Failed to download %s: %v", artifact.GetName(), err)
			continue
		}
		downloadedCount++
	}

	// Step 7: Summary
	fmt.Println()
	if downloadedCount == len(artifacts) {
		climsg.Success("Downloaded %d artifact(s) successfully", downloadedCount)
	} else {
		climsg.Warning("Downloaded %d of %d artifacts", downloadedCount, len(artifacts))
	}
	fmt.Println()

	return nil
}

// filterArtifactsByName filters artifacts by exact name match.
func filterArtifactsByName(artifacts []*agentexecutionv1.ExecutionArtifact, name string) []*agentexecutionv1.ExecutionArtifact {
	var filtered []*agentexecutionv1.ExecutionArtifact
	for _, a := range artifacts {
		if a.GetName() == name {
			filtered = append(filtered, a)
		}
	}
	return filtered
}

// downloadSingleArtifact downloads a single artifact to the output directory.
func downloadSingleArtifact(executionID string, artifact *agentexecutionv1.ExecutionArtifact, outputDir string, client *stigmer.Client) error {
	downloadURL, _, err := execution.GetArtifactDownloadURL(client, executionID, artifact.GetStorageKey())
	if err != nil {
		// Fall back to cached URL if gRPC refresh fails
		downloadURL = artifact.GetDownloadUrl()
		if downloadURL == "" {
			return errors.Wrap(err, "failed to get download URL")
		}
	}

	// Create destination path
	destPath := filepath.Join(outputDir, artifact.GetName())

	// Ensure parent directory exists (for nested paths like "reports/q4.pdf")
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return errors.Wrap(err, "failed to create parent directory")
	}

	climsg.Info("  Downloading %s (%s)...", artifact.GetName(), formatBytesForDownload(artifact.GetSizeBytes()))

	// Download file
	resp, err := http.Get(downloadURL)
	if err != nil {
		return errors.Wrap(err, "HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	// Create destination file
	out, err := os.Create(destPath)
	if err != nil {
		return errors.Wrap(err, "failed to create file")
	}
	defer out.Close()

	// Copy content
	written, err := io.Copy(out, resp.Body)
	if err != nil {
		return errors.Wrap(err, "failed to write file")
	}

	climsg.Success("  Downloaded %s (%s)", artifact.GetName(), formatBytesForDownload(written))
	return nil
}

// isCompletedPhase checks if execution is in a terminal state.
func isCompletedPhase(phase agentexecutionv1.ExecutionPhase) bool {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

// formatPhaseForDownload formats a phase for display in download context.
func formatPhaseForDownload(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "pending"
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "in progress"
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		return "waiting for approval"
	case agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		return "paused"
	default:
		return "unknown"
	}
}

// isURLExpired checks if a timestamp has passed.
func isURLExpired(expiresAt string) bool {
	if expiresAt == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return true
	}
	return time.Now().After(t)
}

// formatBytesForDownload formats bytes as a human-readable string.
func formatBytesForDownload(bytes int64) string {
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
