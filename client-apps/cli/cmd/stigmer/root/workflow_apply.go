package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// workflowApplyOptions contains options for the apply operation.
type workflowApplyOptions struct {
	FilePath    string
	OrgOverride string
	DryRun      bool
}

// newWorkflowApplyCommand creates the workflow apply subcommand.
func newWorkflowApplyCommand() *cobra.Command {
	var orgOverride string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "apply <file>",
		Short: "Apply a workflow configuration",
		Long: `Apply a workflow configuration from a YAML or JSON file.

This command creates a new workflow or updates an existing one based on
the configuration file. It follows Kubernetes-style declarative semantics:
the system reconciles to the desired state specified in the file.

The configuration file must include:
  - apiVersion: agentic.stigmer.ai/v1
  - kind: Workflow
  - metadata.name: Human-readable name
  - spec.document: DSL definition (dsl, namespace, name, version)
  - spec.tasks: At least one task definition`,
		Example: `  # Apply from a specific file
  stigmer workflow apply workflow.yaml

  # Apply to a specific organization
  stigmer workflow apply workflow.yaml --org my-org

  # Dry run (validate without applying)
  stigmer workflow apply workflow.yaml --dry-run

  # Use the 'wf' alias for brevity
  stigmer wf apply workflow.yaml

  # Example workflow.yaml:
  apiVersion: agentic.stigmer.ai/v1
  kind: Workflow
  metadata:
    name: Example Workflow
  spec:
    document:
      dsl: "1.0.0"
      namespace: examples
      name: hello-world
      version: "1.0.0"
    tasks:
      - name: set-greeting
        kind: set_vars
        task_config:
          variables:
            greeting: "Hello, World!"
        export:
          as: "${.}"`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			result, err := executeWorkflowApply(workflowApplyOptions{
				FilePath:    args[0],
				OrgOverride: orgOverride,
				DryRun:      dryRun,
			})
			clierr.Handle(err)

			if !dryRun && result != nil {
				workflow.DisplayApplyResult(result)
			}
		},
	}

	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")

	return cmd
}

// executeWorkflowApply handles the workflow apply operation.
func executeWorkflowApply(opts workflowApplyOptions) (*workflow.ApplyResult, error) {
	// Step 1: Load configuration file
	cliprint.PrintInfo("Loading workflow configuration...")

	loadResult, err := workflow.Load(&workflow.LoadOptions{
		FilePath: opts.FilePath,
	})
	if err != nil {
		return nil, err
	}

	cliprint.PrintSuccess("Loaded configuration from: %s", loadResult.SourcePath)
	cliprint.PrintInfo("  Name: %s", loadResult.Workflow.Metadata.Name)
	fmt.Println()

	// Step 2: Validate cross-field logic
	if err := workflow.Validate(loadResult.Workflow); err != nil {
		return nil, err
	}

	// Step 3: Dry run mode - just validate and preview
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - configuration is valid")
		workflow.DisplayWorkflowPreview(loadResult.Workflow)
		cliprint.PrintSuccess("Dry run successful - no changes made")
		return nil, nil
	}

	// Step 4: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 5: Resolve organization
	orgID, err := resolveWorkflowOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 6: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 7: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")

	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	cliprint.PrintSuccess("Connected to backend")
	fmt.Println()

	// Step 8: Apply the configuration
	result, err := workflow.Apply(&workflow.ApplyOptions{
		Workflow: loadResult.Workflow,
		OrgID:    orgID,
		Conn:     conn,
		Quiet:    false,
		DryRun:   false,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}
