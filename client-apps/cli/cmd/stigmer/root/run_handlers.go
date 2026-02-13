package root

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"google.golang.org/grpc"
)

// runAgent executes an agent.
func runAgent(ref, message string, env envfile.EnvMap, attachments []*agentexecutionv1.Attachment, follow, wait bool, downloadDir, orgID string, conn *grpc.ClientConn) error {
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

	exec, err := createAgentExecution(agent.Metadata.Id, orgID, message, env, attachments, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", exec.Metadata.Id)
	fmt.Println()

	// If wait or download is requested, poll until completion
	if wait || downloadDir != "" {
		exec, err = waitForExecution(exec.Metadata.Id, conn)
		if err != nil {
			return errors.Wrap(err, "error waiting for execution")
		}

		// Display final status
		displayExecutionResult(exec)

		// Download artifacts if requested
		if downloadDir != "" && len(exec.Status.Artifacts) > 0 {
			if err := downloadArtifacts(exec, downloadDir, conn); err != nil {
				return errors.Wrap(err, "failed to download artifacts")
			}
		}
		return nil
	}

	// Stream logs if follow is enabled (and not waiting)
	if follow {
		streamAgentExecutionLogs(exec.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run agent %s --follow", agent.Metadata.Name)
		fmt.Println()
	}

	return nil
}

// waitForExecution polls until execution reaches a terminal state.
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
func downloadArtifact(executionID string, artifact *agentexecutionv1.ExecutionArtifact, downloadDir string, conn *grpc.ClientConn) error {
	// Get download URL (refresh if needed)
	downloadURL := artifact.GetDownloadUrl()
	if downloadURL == "" || isExpired(artifact.GetExpiresAt()) {
		url, _, err := execution.GetArtifactDownloadURL(conn, executionID, artifact.GetStorageKey())
		if err != nil {
			return err
		}
		downloadURL = url
	}

	// Create destination path
	destPath := filepath.Join(downloadDir, artifact.GetName())

	// Ensure parent directory exists (for nested paths)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return errors.Wrap(err, "failed to create parent directory")
	}

	cliprint.PrintInfo("  Downloading %s...", artifact.GetName())

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

	cliprint.PrintSuccess("  Downloaded %s (%s)", artifact.GetName(), formatFileSize(written))
	return nil
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
func runWorkflow(ref, message string, env envfile.EnvMap, follow bool, orgID string, conn *grpc.ClientConn) error {
	// Resolve workflow by reference
	workflow, err := resolveWorkflow(ref, orgID, conn)
	if err != nil {
		displayWorkflowNotFoundError(ref)
		return err
	}

	// Create workflow execution
	cliprint.PrintInfo("Creating workflow execution...")
	execution, err := createWorkflowExecution(workflow.Metadata.Id, orgID, message, env, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Stream logs if follow is enabled
	if follow {
		streamWorkflowExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run workflow %s --follow", workflow.Metadata.Name)
		fmt.Println()
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
