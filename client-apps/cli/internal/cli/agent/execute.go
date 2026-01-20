package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"
)

// ManifestResult contains the results from executing a Go file (agents and/or workflows)
type ManifestResult struct {
	AgentManifest    *agentv1.AgentManifest
	WorkflowManifest *workflowv1.WorkflowManifest
}

// ExecuteGoAgentAndGetManifest runs a Go file that uses stigmer.Run() for synthesis.
//
// Pulumi-Inspired Execution Model:
// Users write declarative code that registers resources (agents, workflows).
// The CLI executes the program and collects the generated manifests.
//
// Example user code:
//
//	package main
//	import "github.com/stigmer/stigmer/sdk/go/stigmer"
//	import "github.com/stigmer/stigmer/sdk/go/agent"
//	import "github.com/stigmer/stigmer/sdk/go/workflow"
//	
//	func main() {
//	    stigmer.Run(func(ctx *stigmer.Context) error {
//	        agent.New(ctx,
//	            agent.WithName("code-reviewer"),
//	            agent.WithInstructions("Review code"),
//	        )
//	        
//	        workflow.New(ctx,
//	            workflow.WithNamespace("data-processing"),
//	            workflow.WithName("daily-sync"),
//	        )
//	        return nil
//	    })
//	}
//
// Execution flow:
// 1. Run user's code with `go run .` (Go compiler validates everything)
// 2. Set STIGMER_OUT_DIR environment variable
// 3. stigmer.Run() calls ctx.Synthesize() which writes manifests
// 4. Read generated manifest files (agent-manifest.pb and/or workflow-manifest.pb)
// 5. Validate that resources were created
//
// This approach:
// ✅ Trusts Go's tooling (no custom validation needed)
// ✅ Provides clear error messages from Go compiler
// ✅ Validates outcomes (resources created) not syntax (imports)
func ExecuteGoAgentAndGetManifest(goFile string) (*ManifestResult, error) {
	// Validate file exists
	absPath, err := filepath.Abs(goFile)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve file path")
	}

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil, errors.Errorf("file not found: %s", goFile)
	}

	// Check file extension
	if filepath.Ext(goFile) != ".go" {
		return nil, errors.Errorf("file must be a Go file (.go): %s", goFile)
	}

	// Get the project directory (directory containing the Go file)
	projectDir := filepath.Dir(absPath)

	// Validate go.mod if it exists
	if err := ValidateGoModule(projectDir); err != nil {
		return nil, errors.Wrap(err, "invalid Go module")
	}

	// Run go mod tidy to ensure dependencies are up to date
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = projectDir
	tidyCmd.Env = os.Environ()
	if tidyOutput, tidyErr := tidyCmd.CombinedOutput(); tidyErr != nil {
		return nil, errors.Errorf("failed to update dependencies:\n%s", string(tidyOutput))
	}

	// Create output directory for manifest files
	outputDir := filepath.Join(projectDir, ".stigmer")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, errors.Wrap(err, "failed to create output directory")
	}

	// Execute the user's code directly with STIGMER_OUT_DIR set
	// stigmer.Run() will handle synthesis automatically
	cmd := exec.Command("go", "run", ".")
	cmd.Dir = projectDir
	cmd.Env = append(os.Environ(), "STIGMER_OUT_DIR="+outputDir)

	// Capture both stdout and stderr
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errorMsg := stderr.String()
		if len(errorMsg) > 500 {
			errorMsg = errorMsg[:500] + "..."
		}
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		return nil, errors.Errorf("failed to execute Go agent:\n%s", errorMsg)
	}

	// Read agent manifest (agent-manifest.pb) if it exists
	result := &ManifestResult{}
	
	agentManifestPath := filepath.Join(outputDir, "agent-manifest.pb")
	if agentData, err := os.ReadFile(agentManifestPath); err == nil {
		var agentManifest agentv1.AgentManifest
		if err := proto.Unmarshal(agentData, &agentManifest); err != nil {
			return nil, errors.Wrap(err, "failed to unmarshal agent-manifest.pb")
		}
		
		// Validate agent manifest
		if agentManifest.SdkMetadata == nil {
			return nil, errors.New("agent manifest has no SDK metadata")
		}
		if len(agentManifest.Agents) == 0 {
			return nil, errors.New("agent manifest has no agents defined")
		}
		
		result.AgentManifest = &agentManifest
	}
	
	// Read workflow manifest (workflow-manifest.pb) if it exists
	workflowManifestPath := filepath.Join(outputDir, "workflow-manifest.pb")
	if workflowData, err := os.ReadFile(workflowManifestPath); err == nil {
		var workflowManifest workflowv1.WorkflowManifest
		if err := proto.Unmarshal(workflowData, &workflowManifest); err != nil {
			return nil, errors.Wrap(err, "failed to unmarshal workflow-manifest.pb")
		}
		
		// Validate workflow manifest
		if workflowManifest.SdkMetadata == nil {
			return nil, errors.New("workflow manifest has no SDK metadata")
		}
		if len(workflowManifest.Workflows) == 0 {
			return nil, errors.New("workflow manifest has no workflows defined")
		}
		
		result.WorkflowManifest = &workflowManifest
	}
	
	// At least one manifest must be present
	if result.AgentManifest == nil && result.WorkflowManifest == nil {
		return nil, errors.New("no resources were created - your code must use Stigmer SDK to define agents or workflows\n\n" +
			"Example:\n" +
			"  import \"github.com/stigmer/stigmer/sdk/go/stigmer\"\n" +
			"  import \"github.com/stigmer/stigmer/sdk/go/agent\"\n\n" +
			"  func main() {\n" +
			"      stigmer.Run(func(ctx *stigmer.Context) error {\n" +
			"          agent.New(ctx, agent.WithName(\"my-agent\"), ...)\n" +
			"          return nil\n" +
			"      })\n" +
			"  }")
	}

	return result, nil
}
