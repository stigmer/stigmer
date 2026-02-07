package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apply"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// NewApplyCommand creates the apply command for deploying resources.
// Supports two modes:
//   - File mode (-f flag): Apply resources from YAML files with auto-detection
//   - Project mode (default): SDK synthesis from stigmer.yaml project
func NewApplyCommand() *cobra.Command {
	var dryRun bool
	var configDir string
	var orgOverride string
	var pruneEnabled bool
	var filePath string

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Apply resources from files or project",
		Long: `Apply resources to the Stigmer backend.

TWO MODES:

1. FILE MODE (with -f flag):
   Apply resources from YAML files. Kind is auto-detected from the file.
   Supports single files, directories, and multi-document YAML.

2. PROJECT MODE (without -f flag):
   Detects stigmer.yaml, runs SDK synthesis, and deploys all resources.
   The backend performs reconciliation (create, update, delete orphans).

FILE MODE supports:
  - Agent, Workflow, McpServer resources
  - Directory paths (applies all .yaml/.yml files)
  - Multi-document YAML (--- separated)

PROJECT MODE supports:
  - Go:     go run <entry_point>
  - Python: python <entry_point>
  - Node:   npx ts-node <entry_point> (for .ts) or node <entry_point>`,
		Example: `  # File mode - apply from YAML file
  stigmer apply -f agent.yaml
  stigmer apply -f workflow.yaml --dry-run
  stigmer apply -f ./manifests/  # directory

  # Project mode - deploy from stigmer.yaml project
  stigmer apply
  stigmer apply --config /path/to/project/
  stigmer apply --dry-run
  stigmer apply --prune=false`,
		Run: func(cmd *cobra.Command, args []string) {
			var err error

			// Mode detection: -f flag means file mode
			if filePath != "" {
				err = executeFileApply(fileApplyOptions{
					FilePath:    filePath,
					OrgOverride: orgOverride,
					DryRun:      dryRun,
				})
			} else {
				err = executeProjectApply(projectApplyOptions{
					ConfigDir:    configDir,
					OrgOverride:  orgOverride,
					DryRun:       dryRun,
					PruneEnabled: pruneEnabled,
				})
			}

			clierr.Handle(err)
		},
	}

	// File mode flags
	cmd.Flags().StringVarP(&filePath, "file", "f", "", "path to YAML file or directory")

	// Project mode flags
	cmd.Flags().StringVar(&configDir, "config", "", "path to project directory (project mode)")
	cmd.Flags().BoolVar(&pruneEnabled, "prune", true, "delete orphaned resources (project mode)")

	// Shared flags
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")

	return cmd
}

// projectApplyOptions contains options for project-based apply.
type projectApplyOptions struct {
	ConfigDir    string
	OrgOverride  string
	DryRun       bool
	PruneEnabled bool
}

// executeProjectApply implements the project SDK synthesis apply mode.
func executeProjectApply(opts projectApplyOptions) error {
	// Step 1: Detect track (Project vs Atomic)
	detectResult, err := project.DetectTrack(&project.DetectOptions{
		StartDir: opts.ConfigDir,
	})
	if err != nil {
		return errors.Wrap(err, "track detection failed")
	}

	// Step 2: Handle Atomic Track (no stigmer.yaml found)
	if detectResult.Track == project.TrackAtomic {
		displayAtomicTrackGuidance()
		return nil
	}

	// Step 3: Use detected Project and directory
	proj := detectResult.Project
	projectDir := detectResult.ConfigDir

	cliprint.PrintSuccess("✓ Found project: %s", proj.Metadata.Name)
	cliprint.PrintInfo("  Runtime:     %s", runtimeToStringForApply(proj.Spec.Runtime))
	cliprint.PrintInfo("  Entry Point: %s", getEntryPoint(proj))
	cliprint.PrintInfo("  Directory:   %s", projectDir)
	fmt.Println()

	// Step 4: Run SDK synthesis
	cliprint.PrintInfo("Running SDK synthesis...")
	synthResult, err := apply.Synthesize(&apply.SynthesizeOptions{
		ProjectDir: projectDir,
		Runtime:    proj.Spec.Runtime,
		EntryPoint: getEntryPoint(proj),
		Quiet:      false,
	})
	if err != nil {
		return errors.Wrap(err, "SDK synthesis failed")
	}

	result := synthResult.Result
	displaySynthesisResult(result)

	// Step 5: Embed synthesized resources into Project.Spec
	// NOTE: No dependency_graph field - backend derives it via proto reflection
	// NOTE: Skills are handled separately - they're pushed as artifacts, not embedded
	proj.Spec.Agents = result.Agents
	proj.Spec.Workflows = result.Workflows
	proj.Spec.McpServers = result.McpServers
	// proj.Spec.Skills will be populated from deployed skills after artifact push

	// Step 6: Handle dry-run mode
	if opts.DryRun {
		displayDryRunPreview(proj, result)
		return nil
	}

	// Step 7: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	// Step 8: Resolve organization
	orgID, err := resolveApplyOrganization(cfg, proj, opts.OrgOverride)
	if err != nil {
		return err
	}

	// Step 9: Ensure daemon is running (local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	// Step 10: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")
	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()
	cliprint.PrintSuccess("✓ Connected to backend")
	fmt.Println()

	// Step 10.5: Verify external skill references
	externalSkillRefs := apply.ExtractExternalSkillRefs(result)
	if len(externalSkillRefs) > 0 {
		cliprint.PrintInfo("Verifying external skill references...")
		verifyResult, err := apply.VerifyExternalSkills(conn, orgID, externalSkillRefs)
		if err != nil {
			return errors.Wrap(err, "skill verification failed")
		}

		if len(verifyResult.Missing) > 0 {
			apply.DisplayMissingSkillsGuidance(verifyResult.Missing)
			return fmt.Errorf("deployment blocked: %d skill(s) not found - push them first", len(verifyResult.Missing))
		}

		cliprint.PrintSuccess("✓ All external skills verified (%d)", len(verifyResult.Found))
		fmt.Println()
	}

	// Step 11: Apply Project to backend
	cliprint.PrintInfo("Deploying resources...")
	applyResult, err := project.Apply(&project.ApplyOptions{
		Project: proj,
		OrgID:   orgID,
		Conn:    conn,
		Quiet:   false,
		DryRun:  false,
		Prune:   opts.PruneEnabled,
	})
	if err != nil {
		return errors.Wrap(err, "failed to deploy project")
	}

	// Step 12: Display reconciliation summary
	displayApplyResult(applyResult, opts.PruneEnabled)

	return nil
}

// displayAtomicTrackGuidance shows guidance when no stigmer.yaml is found.
func displayAtomicTrackGuidance() {
	fmt.Println()
	cliprint.PrintWarning("No stigmer.yaml found in current directory or parents")
	fmt.Println()
	cliprint.PrintInfo("The 'stigmer apply' command requires a project with stigmer.yaml.")
	cliprint.PrintInfo("This enables SDK synthesis and project-based reconciliation.")
	fmt.Println()
	cliprint.PrintInfo("For single-resource deployment, use file mode:")
	cliprint.PrintInfo("  stigmer apply -f agent.yaml")
	cliprint.PrintInfo("  stigmer apply -f workflow.yaml")
	cliprint.PrintInfo("  stigmer apply -f mcpserver.yaml")
	fmt.Println()
	cliprint.PrintInfo("To create a new project:")
	cliprint.PrintInfo("  1. Create stigmer.yaml in your project directory")
	cliprint.PrintInfo("  2. Define your resources using the Stigmer SDK")
	cliprint.PrintInfo("  3. Run 'stigmer apply' to deploy")
	fmt.Println()
}

// displaySynthesisResult shows the synthesis output summary.
func displaySynthesisResult(result *synthesis.Result) {
	cliprint.PrintSuccess("✓ Synthesis complete: %d resource(s) discovered", result.TotalResources())
	fmt.Println()

	if result.SkillSynthCount() > 0 {
		cliprint.PrintInfo("  Skills:      %d", result.SkillSynthCount())
	}
	if result.McpServerCount() > 0 {
		cliprint.PrintInfo("  MCP Servers: %d", result.McpServerCount())
	}
	if result.AgentCount() > 0 {
		cliprint.PrintInfo("  Agents:      %d", result.AgentCount())
	}
	if result.WorkflowCount() > 0 {
		cliprint.PrintInfo("  Workflows:   %d", result.WorkflowCount())
	}
	fmt.Println()
}

// displayDryRunPreview shows a preview of what would be deployed.
func displayDryRunPreview(proj *projectv1.Project, result *synthesis.Result) {
	fmt.Println()
	cliprint.PrintInfo("Dry Run Preview")
	cliprint.PrintInfo("===============")
	fmt.Println()

	resultTable := display.NewApplyResultTable()

	// Add skill synths
	for _, synth := range result.SkillSynths {
		// SkillSynth doesn't have name - use source location
		name := "unknown"
		if synth.GetLocal() != nil {
			name = synth.GetLocal().Path
		} else if synth.GetGit() != nil {
			name = synth.GetGit().Url
		}
		resultTable.AddResource(
			display.ResourceTypeSkill,
			name,
			display.ApplyStatusCreated,
			"",
			nil,
		)
	}

	// Add MCP servers
	for _, mcp := range result.McpServers {
		resultTable.AddResource(
			display.ResourceTypeMcpServer,
			mcp.Metadata.Name,
			display.ApplyStatusCreated,
			"",
			nil,
		)
	}

	// Add agents
	for _, agent := range result.Agents {
		resultTable.AddResource(
			display.ResourceTypeAgent,
			agent.Metadata.Name,
			display.ApplyStatusCreated,
			"",
			nil,
		)
	}

	// Add workflows
	for _, wf := range result.Workflows {
		name := ""
		if wf.Spec != nil && wf.Spec.Document != nil {
			name = wf.Spec.Document.Name
		}
		if name == "" && wf.Metadata != nil {
			name = wf.Metadata.Name
		}
		resultTable.AddResource(
			display.ResourceTypeWorkflow,
			name,
			display.ApplyStatusCreated,
			"",
			nil,
		)
	}

	resultTable.RenderDryRun()

	fmt.Println()
	cliprint.PrintInfo("Run without --dry-run to deploy these resources.")
	fmt.Println()
}

// displayApplyResult shows the result of applying the project.
func displayApplyResult(result *project.ApplyResult, pruneEnabled bool) {
	fmt.Println()
	cliprint.PrintSuccess("🚀 Deployment successful!")
	fmt.Println()

	proj := result.Project
	if result.Created {
		cliprint.PrintInfo("Created project: %s (ID: %s)", proj.Metadata.Name, proj.Metadata.Id)
	} else {
		cliprint.PrintInfo("Updated project: %s (ID: %s)", proj.Metadata.Name, proj.Metadata.Id)
	}

	// Display reconciliation summary if available
	if proj.Status != nil && proj.Status.LastReconciliation != nil {
		recon := proj.Status.LastReconciliation
		fmt.Println()
		cliprint.PrintInfo("Reconciliation Summary:")

		createdCount := len(recon.Created)
		updatedCount := len(recon.Updated)
		deletedCount := len(recon.Deleted)

		if createdCount > 0 {
			cliprint.PrintInfo("  Created: %d resource(s)", createdCount)
			for _, r := range recon.Created {
				cliprint.PrintInfo("    - %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
			}
		}

		if updatedCount > 0 {
			cliprint.PrintInfo("  Updated: %d resource(s)", updatedCount)
			for _, r := range recon.Updated {
				cliprint.PrintInfo("    - %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
			}
		}

		if deletedCount > 0 {
			if pruneEnabled {
				cliprint.PrintInfo("  Deleted: %d orphaned resource(s)", deletedCount)
			} else {
				cliprint.PrintInfo("  Would delete: %d orphaned resource(s) (pruning disabled)", deletedCount)
			}
			for _, r := range recon.Deleted {
				cliprint.PrintInfo("    - %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
			}
		}

		if createdCount == 0 && updatedCount == 0 && deletedCount == 0 {
			cliprint.PrintInfo("  No changes detected")
		}
	}

	// Print next steps
	fmt.Println()
	cliprint.PrintInfo("Next steps:")
	cliprint.PrintInfo("  - View project: stigmer get project %s", proj.Metadata.Name)
	if len(proj.Spec.Agents) > 0 {
		cliprint.PrintInfo("  - Run an agent: stigmer run agent <agent-name>")
	}
	if len(proj.Spec.Workflows) > 0 {
		cliprint.PrintInfo("  - Run a workflow: stigmer run workflow <workflow-name>")
	}
	cliprint.PrintInfo("  - Update and redeploy: edit code and run 'stigmer apply' again")
	fmt.Println()
}

// resolveApplyOrganization determines the organization ID for deployment.
func resolveApplyOrganization(cfg *config.Config, proj *projectv1.Project, override string) (string, error) {
	// Priority: flag override > stigmer.yaml > context > local default
	if override != "" {
		cliprint.PrintInfo("Using organization from flag: %s", override)
		return override, nil
	}

	// Check stigmer.yaml organization field
	if proj.Metadata != nil && proj.Metadata.Org != "" {
		cliprint.PrintInfo("Using organization from stigmer.yaml: %s", proj.Metadata.Org)
		return proj.Metadata.Org, nil
	}

	// Check context (cloud mode)
	if cfg.Backend.Type == config.BackendTypeCloud {
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			cliprint.PrintInfo("Using organization from context: %s", cfg.Backend.Cloud.OrgID)
			return cfg.Backend.Cloud.OrgID, nil
		}
		return "", errors.New("organization not set for cloud mode\n\n" +
			"Specify organization in one of these ways:\n" +
			"  1. Set metadata.org in stigmer.yaml\n" +
			"  2. Use --org flag: stigmer apply --org <org-id>\n" +
			"  3. Set context: stigmer context set --org <org-id>")
	}

	// Local mode default
	cliprint.PrintInfo("Using local backend (organization: local)")
	return "local", nil
}

// getEntryPoint returns the entry point from the project spec, or the default for the runtime.
func getEntryPoint(proj *projectv1.Project) string {
	if proj.Spec != nil && proj.Spec.EntryPoint != "" {
		return proj.Spec.EntryPoint
	}
	return getDefaultEntryPointForApply(proj.Spec.Runtime)
}

// runtimeToStringForApply converts a ProjectRuntime to a display string.
func runtimeToStringForApply(runtime projectv1.ProjectRuntime) string {
	switch runtime {
	case projectv1.ProjectRuntime_go:
		return "go"
	case projectv1.ProjectRuntime_python:
		return "python"
	case projectv1.ProjectRuntime_node:
		return "node"
	default:
		return "unknown"
	}
}

// getDefaultEntryPointForApply returns the default entry point for a runtime.
func getDefaultEntryPointForApply(runtime projectv1.ProjectRuntime) string {
	switch runtime {
	case projectv1.ProjectRuntime_go:
		return "main.go"
	case projectv1.ProjectRuntime_python:
		return "main.py"
	case projectv1.ProjectRuntime_node:
		return "index.ts"
	default:
		return ""
	}
}
