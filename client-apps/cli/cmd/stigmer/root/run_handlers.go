package root

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// waitForExecution polls until execution reaches a terminal state.
//
// LEGACY: This function is retained as a fallback for edge cases (e.g., reconnecting
// after a stream disconnect). The primary execution path uses streamAgentExecution(),
// which streams updates in real-time and handles approvals inline. This polling path
// does NOT handle approvals and will hang if the execution requires user approval.
func waitForExecution(executionID string, client *stigmer.Client) (*agentexecutionv1.AgentExecution, error) {
	climsg.Info("Waiting for execution to complete...")

	pollInterval := 2 * time.Second
	maxPollInterval := 10 * time.Second
	timeout := 30 * time.Minute
	startTime := time.Now()

	for {
		if time.Since(startTime) > timeout {
			return nil, fmt.Errorf("timeout waiting for execution (30 min)")
		}

		exec, err := execution.GetFromBackend(client, executionID)
		if err != nil {
			return nil, err
		}

		phase := exec.GetStatus().GetPhase()
		switch phase {
		case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
			return exec, nil
		case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
			return exec, nil
		case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
			return exec, nil
		case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
			return exec, nil
		}

		// Still running, wait and poll again
		time.Sleep(pollInterval)

		// Exponential backoff up to max
		if pollInterval < maxPollInterval {
			pollInterval = time.Duration(float64(pollInterval) * 1.5)
			if pollInterval > maxPollInterval {
				pollInterval = maxPollInterval
			}
		}
	}
}

// displayExecutionResult shows the final execution status.
func displayExecutionResult(exec *agentexecutionv1.AgentExecution) {
	phase := exec.GetStatus().GetPhase()
	fmt.Println()

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		climsg.Success("Execution completed successfully")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		climsg.Error("Execution failed")
		if exec.GetStatus().GetError() != "" {
			climsg.Error("  Error: %s", exec.GetStatus().GetError())
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		climsg.Warning("Execution was cancelled")
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		climsg.Warning("Execution was terminated")
	}

	// Show artifact summary
	artifacts := exec.GetStatus().GetArtifacts()
	if len(artifacts) > 0 {
		fmt.Println()
		climsg.Info("Artifacts produced: %d", len(artifacts))
		for _, a := range artifacts {
			climsg.Info("  - %s (%s)", a.GetName(), formatFileSize(a.GetSizeBytes()))
		}
	}

	fmt.Println()
}

// artifactResult holds metadata about a downloaded artifact for summary display.
type artifactResult struct {
	Name      string
	Size      int64
	FileCount int // > 0 for directory artifacts
}

// downloadArtifacts downloads all artifacts to the specified directory and
// prints a compact summary. Single artifacts get one line; multiple artifacts
// get a header followed by indented entries.
func downloadArtifacts(exec *agentexecutionv1.AgentExecution, downloadDir string, client *stigmer.Client) error {
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create download directory")
	}

	artifacts := exec.GetStatus().GetArtifacts()
	results := make([]artifactResult, 0, len(artifacts))

	for _, artifact := range artifacts {
		result, err := downloadArtifact(exec.Metadata.Id, artifact, downloadDir, client)
		if err != nil {
			return errors.Wrapf(err, "failed to download %s", artifact.GetName())
		}
		results = append(results, result)
	}

	displayArtifactSummary(results, downloadDir)
	return nil
}

// displayArtifactSummary prints a compact summary of downloaded artifacts.
func displayArtifactSummary(results []artifactResult, downloadDir string) {
	if len(results) == 0 {
		return
	}

	if len(results) == 1 {
		r := results[0]
		climsg.Success("Saved %s (%s)", r.Name, formatFileSize(r.Size))
		return
	}

	climsg.Success("Saved %d artifact(s) to %s", len(results), downloadDir)
	for _, r := range results {
		if r.FileCount > 0 {
			climsg.Info("  %s/ (%s, %d files)", r.Name, formatFileSize(r.Size), r.FileCount)
		} else {
			climsg.Info("  %s (%s)", r.Name, formatFileSize(r.Size))
		}
	}
}

// downloadArtifact downloads a single artifact and returns metadata for the
// summary display. No per-artifact output is printed; the caller handles that.
//
// For directory artifacts (kind=DIRECTORY), the server stores the content as a
// ZIP archive. This function detects directory artifacts, downloads the ZIP,
// and extracts it to downloadDir/artifact.Name/ so that internal directory
// structure (e.g. references/) is preserved on the user's filesystem.
//
// For file artifacts, the content is saved directly as downloadDir/artifact.Name.
func downloadArtifact(executionID string, artifact *agentexecutionv1.ExecutionArtifact, downloadDir string, client *stigmer.Client) (artifactResult, error) {
	downloadURL, _, err := execution.GetArtifactDownloadURL(client, executionID, artifact.GetStorageKey())
	if err != nil {
		downloadURL = artifact.GetDownloadUrl()
		if downloadURL == "" {
			return artifactResult{}, errors.Wrap(err, "failed to get download URL")
		}
	}

	resp, err := http.Get(downloadURL)
	if err != nil {
		return artifactResult{}, errors.Wrap(err, "HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return artifactResult{}, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	name := artifact.GetName()

	if artifact.GetKind() == agentexecutionv1.ExecutionArtifactKind_EXECUTION_ARTIFACT_KIND_DIRECTORY {
		size, fileCount, err := downloadDirectoryArtifact(resp.Body, name, downloadDir)
		if err != nil {
			return artifactResult{}, err
		}
		return artifactResult{Name: name, Size: size, FileCount: fileCount}, nil
	}

	size, err := downloadFileArtifact(resp.Body, name, downloadDir)
	if err != nil {
		return artifactResult{}, err
	}
	return artifactResult{Name: name, Size: size}, nil
}

// downloadFileArtifact saves a single-file artifact to downloadDir/name and
// returns the number of bytes written.
func downloadFileArtifact(body io.Reader, name, downloadDir string) (int64, error) {
	destPath := filepath.Join(downloadDir, name)

	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return 0, errors.Wrap(err, "failed to create parent directory")
	}

	out, err := os.Create(destPath)
	if err != nil {
		return 0, errors.Wrap(err, "failed to create file")
	}
	defer out.Close()

	written, err := io.Copy(out, body)
	if err != nil {
		return 0, errors.Wrap(err, "failed to write file")
	}

	return written, nil
}

// downloadDirectoryArtifact extracts a ZIP-archived directory artifact to
// downloadDir/name/, preserving the internal directory structure. Returns the
// total uncompressed size and file count.
func downloadDirectoryArtifact(body io.Reader, name, downloadDir string) (int64, int, error) {
	// Read the entire ZIP into memory so we can use archive/zip.NewReader
	// (which requires io.ReaderAt + size).  Artifact ZIPs are small (tens of
	// KB for skill packages) so this is safe.
	data, err := io.ReadAll(body)
	if err != nil {
		return 0, 0, errors.Wrap(err, "failed to read artifact content")
	}

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, 0, errors.Wrap(err, "failed to open ZIP archive")
	}

	destDir := filepath.Join(downloadDir, name)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return 0, 0, errors.Wrap(err, "failed to create artifact directory")
	}

	var totalBytes int64
	for _, f := range reader.File {
		if err := extractZipEntry(f, destDir); err != nil {
			return 0, 0, errors.Wrapf(err, "failed to extract %s", f.Name)
		}
		totalBytes += int64(f.UncompressedSize64)
	}

	return totalBytes, len(reader.File), nil
}

// extractZipEntry extracts a single entry from a ZIP archive into destDir.
func extractZipEntry(f *zip.File, destDir string) error {
	// Sanitise the path to prevent zip-slip attacks: the resolved
	// destination must remain within destDir.
	destPath := filepath.Join(destDir, f.Name)
	if !strings.HasPrefix(filepath.Clean(destPath)+string(os.PathSeparator), filepath.Clean(destDir)+string(os.PathSeparator)) {
		return fmt.Errorf("illegal path in ZIP: %s", f.Name)
	}

	if f.FileInfo().IsDir() {
		return os.MkdirAll(destPath, 0755)
	}

	// Ensure parent directory exists.
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}

	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, rc)
	return err
}

// isExpired checks if a timestamp has passed.
func isExpired(expiresAt string) bool {
	if expiresAt == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return true
	}
	return time.Now().After(t)
}

// runWorkflow executes a workflow using the prepared execution context.
func runWorkflow(ref string, prep *preparedAgentExec) error {
	workflow, err := resolveWorkflow(ref, prep.OrgID, prep.Client)
	if err != nil {
		displayWorkflowNotFoundError(ref)
		return err
	}

	climsg.Info("Creating workflow execution...")
	wfExec, err := createWorkflowExecution(workflow.Metadata.Id, prep.OrgID, prep.Message, prep.RuntimeEnv, prep.Client)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	climsg.Success("Workflow execution started: %s", workflow.Metadata.Name)
	climsg.Info("  Execution ID: %s", wfExec.Metadata.Id)
	fmt.Println()

	if prep.Detach {
		return nil
	}

	prompter := approval.NewInteractivePrompter()
	if _, err := streamWorkflowExecution(wfExec.Metadata.Id, prompter, prep.DefaultAction, prep.Client); err != nil {
		return errors.Wrap(err, "error streaming workflow execution")
	}

	return nil
}

// displayAgentNotFoundError shows a helpful error message when agent is not found.
func displayAgentNotFoundError(ref string) {
	climsg.Error("Agent not found: %s", ref)
	climsg.Info("")
	climsg.Info("Possible reasons:")
	climsg.Info("  - Agent doesn't exist in organization")
	climsg.Info("  - Agent hasn't been deployed yet (run: stigmer apply -f agent.yaml)")
	climsg.Info("  - Wrong organization context (use --org to override)")
	fmt.Println()
}

// displayWorkflowNotFoundError shows a helpful error message when workflow is not found.
func displayWorkflowNotFoundError(ref string) {
	climsg.Error("Workflow not found: %s", ref)
	climsg.Info("")
	climsg.Info("Possible reasons:")
	climsg.Info("  - Workflow doesn't exist in organization")
	climsg.Info("  - Workflow hasn't been deployed yet (run: stigmer apply -f workflow.yaml)")
	climsg.Info("  - Wrong organization context (use --org to override)")
	fmt.Println()
}
