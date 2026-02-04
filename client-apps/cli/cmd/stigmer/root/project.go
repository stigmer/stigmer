package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
)

// NewProjectCommand creates the project management command group.
func NewProjectCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "project",
		Aliases: []string{"proj"},
		Short:   "Manage Stigmer projects",
		Long: `Manage Stigmer projects.

A project defines resources (agents, workflows, skills, MCP servers) using
SDK code. The stigmer.yaml file identifies a directory as a Stigmer project.

Project Track vs Atomic Track:
  - Atomic Track: Apply individual resources directly (stigmer agent apply)
  - Project Track: SDK synthesis with reconciliation (stigmer apply)

The project commands work with the local stigmer.yaml file. Use 'stigmer apply'
to deploy a project to the backend.`,
		Example: `  # Display project configuration
  stigmer project info

  # Display in YAML format
  stigmer project info --output yaml

  # Validate project configuration
  stigmer project validate

  # Use the 'proj' alias
  stigmer proj info`,
	}

	cmd.AddCommand(newProjectInfoCommand())
	cmd.AddCommand(newProjectValidateCommand())
	// Phase 5: get, apply, delete

	return cmd
}

// =============================================================================
// Info Command
// =============================================================================

// newProjectInfoCommand creates the project info subcommand.
func newProjectInfoCommand() *cobra.Command {
	var outputFormat string
	var startDir string

	cmd := &cobra.Command{
		Use:   "info",
		Short: "Display project configuration",
		Long: `Display the local stigmer.yaml configuration.

This command reads the stigmer.yaml file from the current directory (or
parent directories) and displays the project configuration.

Output formats:
  table - Human-readable summary (default)
  yaml  - Full configuration as YAML
  json  - Full configuration as JSON (for automation)`,
		Example: `  # Display project info (table format)
  stigmer project info

  # Display as YAML
  stigmer project info --output yaml

  # Display as JSON
  stigmer project info -o json

  # Search from a specific directory
  stigmer project info --dir /path/to/project`,
		Args: cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeProjectInfo(projectInfoOptions{
				OutputFormat: outputFormat,
				StartDir:     startDir,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format (table, yaml, json)")
	cmd.Flags().StringVar(&startDir, "dir", "", "directory to search for stigmer.yaml (default: current directory)")

	return cmd
}

// projectInfoOptions contains options for the info operation.
type projectInfoOptions struct {
	OutputFormat string
	StartDir     string
}

// executeProjectInfo handles the project info operation.
func executeProjectInfo(opts projectInfoOptions) error {
	// Step 1: Detect track (finds and loads stigmer.yaml)
	result, err := project.DetectTrack(&project.DetectOptions{
		StartDir: opts.StartDir,
	})
	if err != nil {
		return err
	}

	// Step 2: Handle Atomic Track (no stigmer.yaml found)
	if result.Track == project.TrackAtomic {
		displayNoProjectFound()
		return nil
	}

	// Step 3: Display project information
	cliprint.PrintInfo("Project found: %s", result.ConfigPath)
	fmt.Println()
	project.DisplayProjectInfo(result.Project, opts.OutputFormat)

	return nil
}

// displayNoProjectFound shows a helpful message when no stigmer.yaml is found.
func displayNoProjectFound() {
	fmt.Println()
	cliprint.PrintInfo("No stigmer.yaml found in current directory or parents.")
	fmt.Println()
	cliprint.PrintInfo("You are operating in Atomic Track mode.")
	cliprint.PrintInfo("In this mode, apply resources directly:")
	fmt.Println()
	cliprint.PrintInfo("  stigmer agent apply agent.yaml")
	cliprint.PrintInfo("  stigmer workflow apply workflow.yaml")
	cliprint.PrintInfo("  stigmer mcp apply mcpserver.yaml")
	fmt.Println()
	cliprint.PrintInfo("To use Project Track, create a stigmer.yaml file:")
	fmt.Println()
	cliprint.PrintInfo("  apiVersion: agentic.stigmer.ai/v1")
	cliprint.PrintInfo("  kind: Project")
	cliprint.PrintInfo("  metadata:")
	cliprint.PrintInfo("    name: my-project")
	cliprint.PrintInfo("  spec:")
	cliprint.PrintInfo("    runtime: go")
	fmt.Println()
}

// =============================================================================
// Validate Command
// =============================================================================

// newProjectValidateCommand creates the project validate subcommand.
func newProjectValidateCommand() *cobra.Command {
	var startDir string

	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate project configuration",
		Long: `Validate the local stigmer.yaml configuration.

This command validates the project configuration without deploying it.
Useful for CI/CD pipelines and pre-commit hooks.

Validation checks:
  - YAML/JSON syntax
  - Proto schema conformance (apiVersion, kind, metadata, spec)
  - Runtime/entry_point consistency (e.g., .go for Go runtime)
  - Reserved name detection (default, system, admin, etc.)
  - Entry point path safety (relative paths only)

Exit codes:
  0 - Configuration is valid
  1 - Configuration is invalid or not found`,
		Example: `  # Validate project configuration
  stigmer project validate

  # Validate in CI pipeline
  stigmer project validate && echo "Valid"

  # Validate from a specific directory
  stigmer project validate --dir /path/to/project`,
		Args: cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeProjectValidate(projectValidateOptions{
				StartDir: startDir,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&startDir, "dir", "", "directory to search for stigmer.yaml (default: current directory)")

	return cmd
}

// projectValidateOptions contains options for the validate operation.
type projectValidateOptions struct {
	StartDir string
}

// executeProjectValidate handles the project validation operation.
func executeProjectValidate(opts projectValidateOptions) error {
	// Step 1: Detect track (finds and loads stigmer.yaml)
	result, err := project.DetectTrack(&project.DetectOptions{
		StartDir: opts.StartDir,
	})
	if err != nil {
		return err
	}

	// Step 2: Handle Atomic Track (no stigmer.yaml found)
	if result.Track == project.TrackAtomic {
		return errors.New("no stigmer.yaml found in current directory or parents\n\n" +
			"To validate a project, ensure a stigmer.yaml file exists.\n" +
			"To use Atomic Track, validate resources directly:\n" +
			"  stigmer agent validate agent.yaml\n" +
			"  stigmer workflow validate workflow.yaml")
	}

	cliprint.PrintInfo("Validating: %s", result.ConfigPath)
	fmt.Println()

	// Step 3: Run cross-field validation
	// Note: Schema validation already happened in DetectTrack via Load()
	if err := project.Validate(result.Project); err != nil {
		return err
	}

	// Step 4: Display success
	project.DisplayValidationSuccess(result.Project, result.ConfigPath)

	return nil
}
