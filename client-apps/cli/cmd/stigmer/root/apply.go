package root

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/deploy"
)

// NewApplyCommand creates the apply command for deploying resources
func NewApplyCommand() *cobra.Command {
	var dryRun bool
	var configFile string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Deploy resources from current project",
		Long: `Deploy or update resources from code.

Reads Stigmer.yaml and executes your entry point (main.go) to deploy Agents/Workflows.
Resources are auto-discovered from your code.

The Stigmer.yaml file only contains metadata:
  name: my-project
  runtime: go
  main: main.go

Run from your project directory containing Stigmer.yaml.`,
		Example: `  # Deploy agents from code
  stigmer apply
  
  # Deploy from specific directory
  stigmer apply --config /path/to/project/
  
  # Deploy with specific config file
  stigmer apply --config /path/to/Stigmer.yaml
  
  # Dry run (validate without deploying)
  stigmer apply --dry-run
  
  # Override organization
  stigmer apply --org my-org-id`,
		Run: func(cmd *cobra.Command, args []string) {
			// Use the reusable apply function
			deployedAgents, deployedWorkflows, err := ApplyCodeMode(ApplyCodeModeOptions{
				ConfigFile:  configFile,
				OrgOverride: orgOverride,
				DryRun:      dryRun,
				Quiet:       false,
			})
			clierr.Handle(err)

			// If dry run or no resources deployed, return
			if dryRun || (len(deployedAgents) == 0 && len(deployedWorkflows) == 0) {
				return
			}

			// Success summary
			cliprint.PrintSuccess("🚀 Deployment successful!")
			fmt.Println()

			if len(deployedAgents) > 0 {
				cliprint.PrintInfo("Deployed agents:")
				for _, deployed := range deployedAgents {
					cliprint.PrintInfo("  • %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id)
				}
				fmt.Println()
			}

			if len(deployedWorkflows) > 0 {
				cliprint.PrintInfo("Deployed workflows:")
				for _, deployed := range deployedWorkflows {
					cliprint.PrintInfo("  • %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id)
				}
				fmt.Println()
			}

			cliprint.PrintInfo("Next steps:")
			if len(deployedAgents) > 0 {
				cliprint.PrintInfo("  - View agents: stigmer agent list")
			}
			if len(deployedWorkflows) > 0 {
				cliprint.PrintInfo("  - View workflows: stigmer workflow list")
			}
			cliprint.PrintInfo("  - Update and redeploy: edit code and run 'stigmer apply' again")
			fmt.Println()
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without deploying")
	cmd.Flags().StringVar(&configFile, "config", "", "path to Stigmer.yaml or directory containing it (default: current directory)")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides Stigmer.yaml and context)")

	return cmd
}

// ApplyCodeModeOptions contains options for applying code mode
type ApplyCodeModeOptions struct {
	ConfigFile  string
	OrgOverride string
	DryRun      bool
	Quiet       bool // If true, suppress detailed output
}

// ApplyCodeMode applies agents and workflows from code (Stigmer.yaml + entry point execution)
// Returns the list of deployed agents and workflows or error
func ApplyCodeMode(opts ApplyCodeModeOptions) ([]*agentv1.Agent, []*workflowv1.Workflow, error) {
	// Step 1: Load Stigmer.yaml (minimal metadata)
	if !opts.Quiet {
		cliprint.PrintInfo("Loading project configuration...")
	}
	
	stigmerConfig, err := config.LoadStigmerConfig(opts.ConfigFile)
	if err != nil {
		return nil, nil, err
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Loaded Stigmer.yaml")
		cliprint.PrintInfo("  Project:  %s", stigmerConfig.Name)
		cliprint.PrintInfo("  Runtime:  %s", stigmerConfig.Runtime)
		if stigmerConfig.Version != "" {
			cliprint.PrintInfo("  Version:  %s", stigmerConfig.Version)
		}
		cliprint.PrintInfo("  Main:     %s", stigmerConfig.Main)
		fmt.Println()
	}

	// Step 2: Get absolute path to entry point
	mainFilePath, err := stigmerConfig.GetMainFilePath()
	if err != nil {
		return nil, nil, err
	}

	// Step 3: Validate entry point file exists
	if !opts.Quiet {
		cliprint.PrintInfo("Validating entry point: %s", stigmerConfig.Main)
	}
	
	err = agent.ValidateGoFile(mainFilePath)
	if err != nil {
		return nil, nil, err
	}
	
	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Entry point is valid")
	}

	// Step 4: Execute entry point to get manifests (auto-discovers resources!)
	if !opts.Quiet {
		cliprint.PrintInfo("Executing entry point to discover resources...")
	}
	
	manifestResult, err := agent.ExecuteGoAgentAndGetManifest(mainFilePath)
	if err != nil {
		return nil, nil, err
	}

	// Count resources
	agentCount := 0
	workflowCount := 0
	if manifestResult.AgentManifest != nil {
		agentCount = len(manifestResult.AgentManifest.Agents)
	}
	if manifestResult.WorkflowManifest != nil {
		workflowCount = len(manifestResult.WorkflowManifest.Workflows)
	}
	totalResources := agentCount + workflowCount

	if totalResources == 0 {
		if !opts.Quiet {
			cliprint.PrintWarning("⚠️  No resources found in manifest")
		}
		return nil, nil, fmt.Errorf("no resources found in manifest")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Manifest loaded: %d resource(s) discovered (%d agent(s), %d workflow(s))", totalResources, agentCount, workflowCount)
		fmt.Println()

		// Show preview of discovered resources
		if agentCount > 0 && manifestResult.AgentManifest != nil {
			cliprint.PrintInfo("Agents discovered: %d", agentCount)
			for i, blueprint := range manifestResult.AgentManifest.Agents {
				cliprint.PrintInfo("  %d. %s", i+1, blueprint.Name)
				if blueprint.Description != "" {
					cliprint.PrintInfo("     Description: %s", blueprint.Description)
				}
			}
			fmt.Println()
		}
		
		if workflowCount > 0 && manifestResult.WorkflowManifest != nil {
			cliprint.PrintInfo("Workflows discovered: %d", workflowCount)
			for i, wf := range manifestResult.WorkflowManifest.Workflows {
				cliprint.PrintInfo("  %d. %s", i+1, wf.Metadata.Name)
				if wf.Spec != nil && wf.Spec.Description != "" {
					cliprint.PrintInfo("     Description: %s", wf.Spec.Description)
				}
			}
			fmt.Println()
		}
	}

	// Dry run mode - stop here
	if opts.DryRun {
		if !opts.Quiet {
			cliprint.PrintSuccess("✓ Dry run successful - all resources are valid")
			cliprint.PrintInfo("Run without --dry-run to deploy %d resource(s)", totalResources)
		}
		return nil, nil, nil
	}

	// Step 5: Load organization (from Stigmer.yaml, --org flag, or context)
	var orgID string
	if opts.OrgOverride != "" {
		if !opts.Quiet {
			cliprint.PrintInfo("Using organization from flag: %s", opts.OrgOverride)
		}
		orgID = opts.OrgOverride
	} else if stigmerConfig.Organization != "" {
		if !opts.Quiet {
			cliprint.PrintInfo("Using organization from Stigmer.yaml: %s", stigmerConfig.Organization)
		}
		orgID = stigmerConfig.Organization
	} else {
		// Try to load from CLI config context
		cfg, err := config.Load()
		if err != nil {
			return nil, nil, err
		}
		
		if cfg.Backend.Type == config.BackendTypeCloud && cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			orgID = cfg.Backend.Cloud.OrgID
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from context: %s", orgID)
			}
		} else {
			return nil, nil, fmt.Errorf("organization not set. Specify in Stigmer.yaml, use --org flag, or run: stigmer context set --org <org-id>")
		}
	}

	// Step 6: Connect to backend
	if !opts.Quiet {
		cliprint.PrintInfo("Connecting to backend...")
	}
	
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, nil, err
	}
	defer conn.Close()

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Connected to backend")
		fmt.Println()
	}

	// Step 7: Deploy resources
	progressCallback := func(msg string) {
		if !opts.Quiet {
			cliprint.PrintInfo("%s", msg)
		}
	}
	
	// Create deployer with options
	deployer := deploy.NewDeployer(&deploy.DeployOptions{
		OrgID:            orgID,
		Conn:             conn,
		Quiet:            opts.Quiet,
		DryRun:           opts.DryRun,
		ProgressCallback: progressCallback,
	})
	
	// Deploy all resources
	deployResult, err := deployer.Deploy(manifestResult)
	if err != nil {
		return nil, nil, err
	}
	
	if !opts.Quiet && !opts.DryRun {
		fmt.Println()
	}
	
	return deployResult.DeployedAgents, deployResult.DeployedWorkflows, nil
}
