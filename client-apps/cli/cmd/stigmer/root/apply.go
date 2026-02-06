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

// NewApplyCommand creates the apply command for deploying resources from a Project.
func NewApplyCommand() *cobra.Command {
	var dryRun bool
	var configDir string
	var orgOverride string
	var pruneEnabled bool

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Deploy resources from current project",
		Long: `Deploy resources from your Stigmer project.

Detects your project configuration (stigmer.yaml), executes SDK synthesis,
and deploys all resources (agents, workflows, skills, mcp servers) to the backend.

The backend performs reconciliation:
  - Creates new resources
  - Updates changed resources
  - Deletes orphaned resources (unless --prune=false)

Track Detection:
  - Project Track: stigmer.yaml found - runs SDK synthesis
  - Atomic Track: no stigmer.yaml - use 'stigmer <resource> apply <file>' instead

Runtimes Supported:
  - Go:     go run <entry_point>
  - Python: python <entry_point>
  - Node:   npx ts-node <entry_point> (for .ts) or node <entry_point>`,
		Example: `  # Deploy from current directory
  stigmer apply
  
  # Deploy from specific directory
  stigmer apply --config /path/to/project/
  
  # Dry run (validate and preview without deploying)
  stigmer apply --dry-run
  
  # Deploy without orphan pruning
  stigmer apply --prune=false
  
  # Override organization
  stigmer apply --org my-org-id`,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeApply(applyOptions{
				ConfigDir:    configDir,
				OrgOverride:  orgOverride,
				DryRun:       dryRun,
				PruneEnabled: pruneEnabled,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate and preview without deploying")
	cmd.Flags().StringVar(&configDir, "config", "", "path to project directory containing stigmer.yaml (default: current directory)")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides stigmer.yaml and context)")
	cmd.Flags().BoolVar(&pruneEnabled, "prune", true, "delete orphaned resources not in SDK output (disable with --prune=false)")

	return cmd
}

// applyOptions contains options for the apply command.
type applyOptions struct {
	ConfigDir    string
	OrgOverride  string
	DryRun       bool
	PruneEnabled bool
}

// executeApply implements the apply command logic.
func executeApply(opts applyOptions) error {
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
	cliprint.PrintInfo("For single-resource deployment (Atomic Track), use:")
	cliprint.PrintInfo("  stigmer agent apply <file.yaml>")
	cliprint.PrintInfo("  stigmer workflow apply <file.yaml>")
	cliprint.PrintInfo("  stigmer mcpserver apply <file.yaml>")
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
	cliprint.PrintInfo("  - View project: stigmer project get %s", proj.Metadata.Name)
	if len(proj.Spec.Agents) > 0 {
		cliprint.PrintInfo("  - Run an agent: stigmer agent run <agent-name>")
	}
	if len(proj.Spec.Workflows) > 0 {
		cliprint.PrintInfo("  - Run a workflow: stigmer workflow run <workflow-name>")
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
