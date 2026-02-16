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
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"google.golang.org/grpc"
)

// runAgent executes an agent.
//
// By default, it streams execution updates in real-time until the execution
// reaches a terminal state. If detach is true, it creates the execution and
// returns immediately without streaming.
//
// defaultAction is the --approve-default flag value; when set, non-TTY approvals
// are auto-resolved without prompting.
func runAgent(ref, message string, env envfile.EnvMap, attachments []*agentexecutionv1.Attachment, detach bool, downloadDir, orgID string, defaultAction approval.Action, conn *grpc.ClientConn) error {
	// Resolve agent by reference
	agent, err := resolveAgent(ref, orgID, conn)
	if err != nil {
		displayAgentNotFoundError(ref)
		return err
	}

	// Create agent execution
	if len(attachments) > 0 {
		cliprint.PrintInfo("Creating agent execution with %d attachment(s)...", len(attachments))
	} else {
		cliprint.PrintInfo("Creating agent execution...")
	}

	exec, err := createAgentExecution(agent.Metadata.Id, orgID, message, env, attachments, "", false, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", exec.Metadata.Id)
	fmt.Println()

	// Detach mode: print execution ID and return immediately
	if detach {
		return nil
	}

	// Stream execution in real-time until completion
	prompter := approval.NewInteractivePrompter()
	exec, err = streamAgentExecution(exec.Metadata.Id, prompter, defaultAction, conn)
	if err != nil {
		return errors.Wrap(err, "error streaming execution")
	}

	// Download artifacts if requested
	if downloadDir != "" && len(exec.Status.Artifacts) > 0 {
		if err := downloadArtifacts(exec, downloadDir, conn); err != nil {
			return errors.Wrap(err, "failed to download artifacts")
		}
	}

	return nil
}

// waitForExecution polls until execution reaches a terminal state.
//
// LEGACY: This function is retained as a fallback for edge cases (e.g., reconnecting
// after a stream disconnect). The primary execution path uses streamAgentExecution(),
// which streams updates in real-time and handles approvals inline. This polling path
// does NOT handle approvals and will hang if the execution requires user approval.
func waitForExecution(executionID string, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	cliprint.PrintInfo("Waiting for execution to complete...")

	pollInterval := 2 * time.Second
	maxPollInterval := 10 * time.Second
	timeout := 30 * time.Minute
	startTime := time.Now()

	for {
		if time.Since(startTime) > timeout {
			return nil, fmt.Errorf("timeout waiting for execution (30 min)")
		}

		exec, err := execution.GetFromBackend(conn, executionID)
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
		cliprint.PrintSuccess("Execution completed successfully")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("Execution failed")
		if exec.GetStatus().GetError() != "" {
			cliprint.PrintError("  Error: %s", exec.GetStatus().GetError())
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("Execution was cancelled")
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		cliprint.PrintWarning("Execution was terminated")
	}

	// Show artifact summary
	artifacts := exec.GetStatus().GetArtifacts()
	if len(artifacts) > 0 {
		fmt.Println()
		cliprint.PrintInfo("Artifacts produced: %d", len(artifacts))
		for _, a := range artifacts {
			cliprint.PrintInfo("  - %s (%s)", a.GetName(), formatFileSize(a.GetSizeBytes()))
		}
	}

	fmt.Println()
}

// downloadArtifacts downloads all artifacts to the specified directory.
func downloadArtifacts(exec *agentexecutionv1.AgentExecution, downloadDir string, conn *grpc.ClientConn) error {
	// Create download directory if it doesn't exist
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create download directory")
	}

	artifacts := exec.GetStatus().GetArtifacts()
	cliprint.PrintInfo("Downloading %d artifact(s) to %s...", len(artifacts), downloadDir)
	fmt.Println()

	for _, artifact := range artifacts {
		if err := downloadArtifact(exec.Metadata.Id, artifact, downloadDir, conn); err != nil {
			return errors.Wrapf(err, "failed to download %s", artifact.GetName())
		}
	}

	cliprint.PrintSuccess("All artifacts downloaded")
	fmt.Println()
	return nil
}

// downloadArtifact downloads a single artifact.
//
// For directory artifacts (kind=DIRECTORY), the server stores the content as a
// ZIP archive.  This function detects directory artifacts, downloads the ZIP,
// and extracts it to downloadDir/artifact.Name/ so that internal directory
// structure (e.g. references/) is preserved on the user's filesystem.
//
// For file artifacts, the content is saved directly as downloadDir/artifact.Name.
func downloadArtifact(executionID string, artifact *agentexecutionv1.ExecutionArtifact, downloadDir string, conn *grpc.ClientConn) error {
	// Always refresh the download URL via gRPC. The cached URL in the execution
	// status may use a Docker-internal hostname (host.docker.internal) that is
	// inappropriate for CLI-side HTTP requests. The server generates a fresh URL
	// using the host-appropriate base address (e.g., localhost).
	downloadURL, _, err := execution.GetArtifactDownloadURL(conn, executionID, artifact.GetStorageKey())
	if err != nil {
		// Fall back to cached URL if gRPC refresh fails
		downloadURL = artifact.GetDownloadUrl()
		if downloadURL == "" {
			return errors.Wrap(err, "failed to get download URL")
		}
	}

	cliprint.PrintInfo("  Downloading %s...", artifact.GetName())

	// Download content
	resp, err := http.Get(downloadURL)
	if err != nil {
		return errors.Wrap(err, "HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	// Directory artifacts are stored as ZIP archives.  Extract them to
	// preserve internal directory structure (e.g. SKILL.md + references/).
	if artifact.GetKind() == agentexecutionv1.ExecutionArtifactKind_EXECUTION_ARTIFACT_KIND_DIRECTORY {
		return downloadDirectoryArtifact(resp.Body, artifact.GetName(), downloadDir)
	}

	return downloadFileArtifact(resp.Body, artifact.GetName(), downloadDir)
}

// downloadFileArtifact saves a single-file artifact to downloadDir/name.
func downloadFileArtifact(body io.Reader, name, downloadDir string) error {
	destPath := filepath.Join(downloadDir, name)

	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return errors.Wrap(err, "failed to create parent directory")
	}

	out, err := os.Create(destPath)
	if err != nil {
		return errors.Wrap(err, "failed to create file")
	}
	defer out.Close()

	written, err := io.Copy(out, body)
	if err != nil {
		return errors.Wrap(err, "failed to write file")
	}

	cliprint.PrintSuccess("  Downloaded %s (%s)", name, formatFileSize(written))
	return nil
}

// downloadDirectoryArtifact extracts a ZIP-archived directory artifact to
// downloadDir/name/, preserving the internal directory structure.
func downloadDirectoryArtifact(body io.Reader, name, downloadDir string) error {
	// Read the entire ZIP into memory so we can use archive/zip.NewReader
	// (which requires io.ReaderAt + size).  Artifact ZIPs are small (tens of
	// KB for skill packages) so this is safe.
	data, err := io.ReadAll(body)
	if err != nil {
		return errors.Wrap(err, "failed to read artifact content")
	}

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return errors.Wrap(err, "failed to open ZIP archive")
	}

	destDir := filepath.Join(downloadDir, name)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create artifact directory")
	}

	var totalBytes int64
	for _, f := range reader.File {
		if err := extractZipEntry(f, destDir); err != nil {
			return errors.Wrapf(err, "failed to extract %s", f.Name)
		}
		totalBytes += int64(f.UncompressedSize64)
	}

	cliprint.PrintSuccess("  Extracted %s/ (%s, %d files)", name, formatFileSize(totalBytes), len(reader.File))
	return nil
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

// runWorkflow executes a workflow.
//
// By default, it streams execution updates in real-time until the execution
// reaches a terminal state. If detach is true, it creates the execution and
// returns immediately without streaming.
//
// defaultAction is the --approve-default flag value; when set, non-TTY approvals
// are auto-resolved without prompting.
func runWorkflow(ref, message string, env envfile.EnvMap, detach bool, orgID string, defaultAction approval.Action, conn *grpc.ClientConn) error {
	// Resolve workflow by reference
	workflow, err := resolveWorkflow(ref, orgID, conn)
	if err != nil {
		displayWorkflowNotFoundError(ref)
		return err
	}

	// Create workflow execution
	cliprint.PrintInfo("Creating workflow execution...")
	wfExec, err := createWorkflowExecution(workflow.Metadata.Id, orgID, message, env, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", wfExec.Metadata.Id)
	fmt.Println()

	// Detach mode: print execution ID and return immediately
	if detach {
		return nil
	}

	// Stream execution in real-time until completion
	prompter := approval.NewInteractivePrompter()
	if _, err := streamWorkflowExecution(wfExec.Metadata.Id, prompter, defaultAction, conn); err != nil {
		return errors.Wrap(err, "error streaming workflow execution")
	}

	return nil
}

// displayAgentNotFoundError shows a helpful error message when agent is not found.
func displayAgentNotFoundError(ref string) {
	cliprint.PrintError("Agent not found: %s", ref)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Possible reasons:")
	cliprint.PrintInfo("  - Agent doesn't exist in organization")
	cliprint.PrintInfo("  - Agent hasn't been deployed yet (run: stigmer apply -f agent.yaml)")
	cliprint.PrintInfo("  - Wrong organization context (use --org to override)")
	fmt.Println()
}

// displayWorkflowNotFoundError shows a helpful error message when workflow is not found.
func displayWorkflowNotFoundError(ref string) {
	cliprint.PrintError("Workflow not found: %s", ref)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Possible reasons:")
	cliprint.PrintInfo("  - Workflow doesn't exist in organization")
	cliprint.PrintInfo("  - Workflow hasn't been deployed yet (run: stigmer apply -f workflow.yaml)")
	cliprint.PrintInfo("  - Wrong organization context (use --org to override)")
	fmt.Println()
}
