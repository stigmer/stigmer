package root

import (
	"fmt"
	"os"
	"path/filepath"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/deploy"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
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
			// Determine working directory
			workDir, err := determineWorkingDirectory(configFile)
			clierr.Handle(err)

			// Check for SKILL.md to determine mode
			if artifact.HasSkillFile(workDir) {
				// Artifact Mode: Upload skill artifact
				cliprint.PrintInfo("Detected SKILL.md - entering Artifact Mode")
				fmt.Println()
				
				result, err := ApplyArtifactMode(ApplyArtifactModeOptions{
					Directory:   workDir,
					OrgOverride: orgOverride,
					Tag:         "",  // Default to "latest"
					DryRun:      dryRun,
					Quiet:       false,
				})
				clierr.Handle(err)
				
				// Display result
				if !dryRun && result != nil {
					cliprint.PrintSuccess("🚀 Skill uploaded successfully!")
					fmt.Println()
					cliprint.PrintInfo("Skill Details:")
					cliprint.PrintInfo("  Name:         %s", result.SkillName)
					cliprint.PrintInfo("  Version Hash: %s", result.VersionHash)
					if result.Tag != "" {
						cliprint.PrintInfo("  Tag:          %s", result.Tag)
					}
					cliprint.PrintInfo("  Size:         %s", formatBytes(result.ArtifactSize))
					fmt.Println()
					cliprint.PrintInfo("Next steps:")
					cliprint.PrintInfo("  - Reference this skill in your agent code")
					cliprint.PrintInfo("  - Update and re-upload: edit files and run 'stigmer apply' again")
					fmt.Println()
				}
				return
			}

			// Code Mode: Deploy from Stigmer.yaml + code execution
			deployedSkills, deployedAgents, deployedWorkflows, err := ApplyCodeMode(ApplyCodeModeOptions{
				ConfigFile:  configFile,
				OrgOverride: orgOverride,
				DryRun:      dryRun,
				Quiet:       false,
			})
			clierr.Handle(err)

			// If no resources deployed, return
			if len(deployedSkills) == 0 && len(deployedAgents) == 0 && len(deployedWorkflows) == 0 {
				return
			}

			// Create and populate results table
			resultTable := display.NewApplyResultTable()

			// Add skills to table
			for _, deployed := range deployedSkills {
				resultTable.AddResource(
					display.ResourceTypeSkill,
					deployed.Metadata.Name,
					display.ApplyStatusCreated,
					deployed.Metadata.Id,
					nil,
				)
			}

			// Add agents to table
			for _, deployed := range deployedAgents {
				resultTable.AddResource(
					display.ResourceTypeAgent,
					deployed.Metadata.Name,
					display.ApplyStatusCreated,
					deployed.Metadata.Id,
					nil,
				)
			}

			// Add workflows to table
			for _, deployed := range deployedWorkflows {
				resultTable.AddResource(
					display.ResourceTypeWorkflow,
					deployed.Metadata.Name,
					display.ApplyStatusCreated,
					deployed.Metadata.Id,
					nil,
				)
			}

			// Render appropriate output
			if dryRun {
				resultTable.RenderDryRun()
			} else {
				cliprint.PrintSuccess("🚀 Deployment successful!")
				resultTable.Render()

				// Print next steps
				cliprint.PrintInfo("Next steps:")
				if len(deployedSkills) > 0 {
					cliprint.PrintInfo("  - View skills: stigmer skill list")
				}
				if len(deployedAgents) > 0 {
					cliprint.PrintInfo("  - View agents: stigmer agent list")
				}
				if len(deployedWorkflows) > 0 {
					cliprint.PrintInfo("  - View workflows: stigmer workflow list")
				}
				cliprint.PrintInfo("  - Update and redeploy: edit code and run 'stigmer apply' again")
				fmt.Println()
			}
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

// ApplyCodeMode applies skills, agents, and workflows from code (Stigmer.yaml + entry point execution)
// Returns the list of deployed skills, agents, and workflows or error
func ApplyCodeMode(opts ApplyCodeModeOptions) ([]*skillv1.Skill, []*agentv1.Agent, []*workflowv1.Workflow, error) {
	// Step 1: Load Stigmer.yaml (minimal metadata)
	if !opts.Quiet {
		cliprint.PrintInfo("Loading project configuration...")
	}
	
	stigmerConfig, err := config.LoadStigmerConfig(opts.ConfigFile)
	if err != nil {
		return nil, nil, nil, err
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
		return nil, nil, nil, err
	}

	// Step 3: Execute entry point to get synthesis result (auto-discovers resources!)
	if !opts.Quiet {
		cliprint.PrintInfo("Executing entry point to discover resources...")
	}
	
	synthesisResult, err := agent.ExecuteGoAndGetSynthesis(mainFilePath)
	if err != nil {
		return nil, nil, nil, err
	}

	// Count resources
	skillCount := synthesisResult.SkillCount()
	agentCount := synthesisResult.AgentCount()
	workflowCount := synthesisResult.WorkflowCount()
	totalResources := synthesisResult.TotalResources()

	if totalResources == 0 {
		if !opts.Quiet {
			cliprint.PrintWarning("⚠️  No resources found in synthesis output")
		}
		return nil, nil, nil, fmt.Errorf("no resources found in synthesis output")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Synthesis complete: %d resource(s) discovered (%d skill(s), %d agent(s), %d workflow(s))", 
			totalResources, skillCount, agentCount, workflowCount)
		fmt.Println()

		// Show preview of discovered resources
		if skillCount > 0 {
			cliprint.PrintInfo("Skills discovered: %d", skillCount)
			for i, skill := range synthesisResult.Skills {
				cliprint.PrintInfo("  %d. %s", i+1, skill.Metadata.Name)
				// Note: Description field removed from SkillSpec in T01.1
			}
			fmt.Println()
		}

		if agentCount > 0 {
			cliprint.PrintInfo("Agents discovered: %d", agentCount)
			for i, agent := range synthesisResult.Agents {
				cliprint.PrintInfo("  %d. %s", i+1, agent.Metadata.Name)
				if agent.Spec.Description != "" {
					cliprint.PrintInfo("     Description: %s", agent.Spec.Description)
				}
			}
			fmt.Println()
		}
		
		if workflowCount > 0 {
			cliprint.PrintInfo("Workflows discovered: %d", workflowCount)
			for i, wf := range synthesisResult.Workflows {
				cliprint.PrintInfo("  %d. %s", i+1, wf.Metadata.Name)
				if wf.Spec.Description != "" {
					cliprint.PrintInfo("     Description: %s", wf.Spec.Description)
				}
			}
			fmt.Println()
		}
	}

	// Dry run mode - stop here
	if opts.DryRun {
		if !opts.Quiet {
			// Create table for dry-run display
			resultTable := display.NewApplyResultTable()
			
			// Add skills to table
			for _, skill := range synthesisResult.Skills {
				resultTable.AddResource(
					display.ResourceTypeSkill,
					skill.Metadata.Name,
					display.ApplyStatusCreated,
					"",
					nil,
				)
			}
			
			// Add agents to table
			for _, agent := range synthesisResult.Agents {
				resultTable.AddResource(
					display.ResourceTypeAgent,
					agent.Metadata.Name,
					display.ApplyStatusCreated,
					"",
					nil,
				)
			}
			
			// Add workflows to table
			for _, wf := range synthesisResult.Workflows {
				resultTable.AddResource(
					display.ResourceTypeWorkflow,
					wf.Metadata.Name,
					display.ApplyStatusCreated,
					"",
					nil,
				)
			}
			
			// Render dry-run table
			resultTable.RenderDryRun()
		}
		return nil, nil, nil, nil
	}

	// Step 5: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, nil, err
	}

	// Step 6: Determine organization based on backend mode
	var orgID string
	
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		// Local mode: Use constant organization name
		// No auth, no cloud features - just local development
		orgID = "local"
		if !opts.Quiet {
			cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		}

	case config.BackendTypeCloud:
		// Cloud mode: Organization is required from multiple sources
		if opts.OrgOverride != "" {
			orgID = opts.OrgOverride
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from flag: %s", orgID)
			}
		} else if stigmerConfig.Organization != "" {
			orgID = stigmerConfig.Organization
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from Stigmer.yaml: %s", orgID)
			}
		} else if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			orgID = cfg.Backend.Cloud.OrgID
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from context: %s", orgID)
			}
		} else {
			return nil, nil, nil, fmt.Errorf("organization not set for cloud mode. Specify in Stigmer.yaml, use --org flag, or run: stigmer context set --org <org-id>")
		}

	default:
		return nil, nil, nil, fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}

	// Step 7: Ensure daemon is running (auto-start if needed, local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		// Always use hardcoded data directory - not configurable
		// CLI manages daemon infrastructure, users shouldn't change this
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, nil, nil, err
		}
		
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, nil, nil, err
		}
	}

	// Step 8: Connect to backend
	if !opts.Quiet {
		cliprint.PrintInfo("Connecting to backend...")
	}
	
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, nil, nil, err
	}
	defer conn.Close()

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Connected to backend")
		fmt.Println()
	}

	// Step 9: Deploy resources
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
	deployResult, err := deployer.Deploy(synthesisResult)
	if err != nil {
		return nil, nil, nil, err
	}
	
	if !opts.Quiet && !opts.DryRun {
		fmt.Println()
	}
	
	return deployResult.DeployedSkills, deployResult.DeployedAgents, deployResult.DeployedWorkflows, nil
}

// ApplyArtifactModeOptions contains options for artifact mode
type ApplyArtifactModeOptions struct {
	Directory   string
	OrgOverride string
	Tag         string
	DryRun      bool
	Quiet       bool
}

// ApplyArtifactMode uploads a skill artifact from the current directory
func ApplyArtifactMode(opts ApplyArtifactModeOptions) (*artifact.SkillArtifactResult, error) {
	// Dry run mode - just validate SKILL.md exists
	if opts.DryRun {
		if !opts.Quiet {
			cliprint.PrintInfo("Dry run mode - would upload skill from: %s", opts.Directory)
			cliprint.PrintInfo("  Tag: %s", getTagOrDefault(opts.Tag))
		}
		return nil, nil
	}

	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Determine organization based on backend mode
	var orgID string
	
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		// Local mode: Use constant organization name
		orgID = "local"
		if !opts.Quiet {
			cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		}

	case config.BackendTypeCloud:
		// Cloud mode: Organization is required from multiple sources
		if opts.OrgOverride != "" {
			orgID = opts.OrgOverride
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from flag: %s", orgID)
			}
		} else if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			orgID = cfg.Backend.Cloud.OrgID
			if !opts.Quiet {
				cliprint.PrintInfo("Using organization from context: %s", orgID)
			}
		} else {
			return nil, fmt.Errorf("organization not set for cloud mode. Use --org flag or run: stigmer context set --org <org-id>")
		}

	default:
		return nil, fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}

	// Step 3: Ensure daemon is running (local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}
		
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 4: Connect to backend
	if !opts.Quiet {
		cliprint.PrintInfo("Connecting to backend...")
	}
	
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Connected to backend")
		fmt.Println()
	}

	// Step 5: Upload skill artifact
	result, err := artifact.PushSkill(&artifact.SkillArtifactOptions{
		Directory: opts.Directory,
		OrgID:     orgID,
		Tag:       getTagOrDefault(opts.Tag),
		Conn:      conn,
		Quiet:     opts.Quiet,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// determineWorkingDirectory determines the working directory based on configFile flag
func determineWorkingDirectory(configFile string) (string, error) {
	if configFile == "" {
		// Use current directory
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("failed to get current directory: %w", err)
		}
		return cwd, nil
	}

	// Check if configFile is a directory or file
	info, err := os.Stat(configFile)
	if err != nil {
		return "", fmt.Errorf("failed to stat %s: %w", configFile, err)
	}

	if info.IsDir() {
		// It's a directory
		return configFile, nil
	}

	// It's a file - use its parent directory
	return filepath.Dir(configFile), nil
}

// getTagOrDefault returns the tag or "latest" if empty
func getTagOrDefault(tag string) string {
	if tag == "" {
		return "latest"
	}
	return tag
}

// formatBytes formats a byte count into a human-readable string
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
