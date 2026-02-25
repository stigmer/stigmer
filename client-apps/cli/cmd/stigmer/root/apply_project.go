package root

import (
	"fmt"
	"os"
	"strings"

	"github.com/pkg/errors"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apply"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

func executeProjectApply(opts projectApplyOptions) error {
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)

	detectResult, err := project.DetectTrack(&project.DetectOptions{StartDir: opts.ConfigDir})
	if err != nil {
		return errors.Wrap(err, "track detection failed")
	}
	if detectResult.Track == project.TrackAtomic {
		renderer.Render(buildAtomicTrackResult())
		return nil
	}

	proj := detectResult.Project
	projectDir := detectResult.ConfigDir
	fmt.Fprintf(os.Stderr, "Found project: %s\n", proj.Metadata.Name)
	fmt.Fprintf(os.Stderr, "  Runtime:     %s\n", runtimeToStringForApply(proj.Spec.Runtime))
	fmt.Fprintf(os.Stderr, "  Entry Point: %s\n", getEntryPoint(proj))
	fmt.Fprintf(os.Stderr, "  Directory:   %s\n\n", projectDir)

	fmt.Fprintf(os.Stderr, "Running SDK synthesis...\n")
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
	renderer.Render(buildSynthesisResult(result))

	proj.Spec.Agents = result.Agents
	proj.Spec.Workflows = result.Workflows
	proj.Spec.McpServers = result.McpServers

	if opts.DryRun {
		renderer.Render(buildDryRunPreview(result))
		return nil
	}

	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}
	orgID, err := resolveApplyOrganization(cfg, proj, opts.OrgOverride)
	if err != nil {
		return err
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	fmt.Fprintf(os.Stderr, "Connecting to backend...\n")
	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()
	fmt.Fprintf(os.Stderr, "Connected to backend\n\n")

	externalSkillRefs := apply.ExtractExternalSkillRefs(result)
	if len(externalSkillRefs) > 0 {
		fmt.Fprintf(os.Stderr, "Verifying external skill references...\n")
		verifyResult, err := apply.VerifyExternalSkills(conn, orgID, externalSkillRefs)
		if err != nil {
			return errors.Wrap(err, "skill verification failed")
		}
		if len(verifyResult.Missing) > 0 {
			renderer.Render(buildMissingSkillsResult(verifyResult.Missing))
			return fmt.Errorf("deployment blocked: %d skill(s) not found - push them first", len(verifyResult.Missing))
		}
		fmt.Fprintf(os.Stderr, "All external skills verified (%d)\n\n", len(verifyResult.Found))
	}

	fmt.Fprintf(os.Stderr, "Deploying resources...\n")
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

	renderer.Render(buildDeploymentResult(applyResult, opts.PruneEnabled))
	return nil
}

func buildAtomicTrackResult() *clioutput.CommandResult {
	result := clioutput.Warning("No stigmer.yaml found in current directory or parents")
	result.AddSection("").
		Item("The 'stigmer apply' command requires a project with stigmer.yaml").
		Item("This enables SDK synthesis and project-based reconciliation")
	result.AddSection("For single-resource deployment, use file mode").
		Item("stigmer apply -f agent.yaml").
		Item("stigmer apply -f workflow.yaml").
		Item("stigmer apply -f mcpserver.yaml")
	result.Hint("To create a new project: create stigmer.yaml, define resources with the SDK, run 'stigmer apply'")
	return result
}

func buildSynthesisResult(result *synthesis.Result) *clioutput.CommandResult {
	out := clioutput.Success("Synthesis complete: %d resource(s) discovered", result.TotalResources())
	sec := out.AddSection("Resources")
	if result.SkillSynthCount() > 0 {
		sec.Fieldf("Skills", "%d", result.SkillSynthCount())
	}
	if result.McpServerCount() > 0 {
		sec.Fieldf("MCP Servers", "%d", result.McpServerCount())
	}
	if result.AgentCount() > 0 {
		sec.Fieldf("Agents", "%d", result.AgentCount())
	}
	if result.WorkflowCount() > 0 {
		sec.Fieldf("Workflows", "%d", result.WorkflowCount())
	}
	return out
}

func buildDryRunPreview(result *synthesis.Result) *clioutput.CommandResult {
	out := clioutput.Success("Dry run: %d resource(s) would be applied", result.TotalResources())
	sec := out.AddSection("Resources")
	for _, synth := range result.SkillSynths {
		name := "unknown"
		if synth.GetLocal() != nil {
			name = synth.GetLocal().Path
		} else if synth.GetGit() != nil {
			name = synth.GetGit().Url
		}
		sec.Itemf("Skill: %s (Create)", name)
	}
	for _, mcp := range result.McpServers {
		sec.Itemf("McpServer: %s (Create)", mcp.Metadata.Name)
	}
	for _, a := range result.Agents {
		sec.Itemf("Agent: %s (Create)", a.Metadata.Name)
	}
	for _, wf := range result.Workflows {
		name := ""
		if wf.Spec != nil && wf.Spec.Document != nil {
			name = wf.Spec.Document.Name
		}
		if name == "" && wf.Metadata != nil {
			name = wf.Metadata.Name
		}
		if name == "" {
			name = "unknown"
		}
		sec.Itemf("Workflow: %s (Create)", name)
	}

	out.Hint("Run without --dry-run to deploy these resources.")
	return out
}

func buildDeploymentResult(result *project.ApplyResult, pruneEnabled bool) *clioutput.CommandResult {
	proj := result.Project
	action := "Updated"
	if result.Created {
		action = "Created"
	}

	out := clioutput.Success("Deployment successful")
	out.AddSection("Project").
		Fieldf("Name", "%s (%s)", proj.Metadata.Name, action).
		Field("ID", proj.Metadata.Id)

	if proj.Status != nil && proj.Status.LastReconciliation != nil {
		recon := proj.Status.LastReconciliation
		sec := out.AddSection("Reconciliation")
		for _, r := range recon.Created {
			sec.Itemf("Created %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
		}
		for _, r := range recon.Updated {
			sec.Itemf("Updated %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
		}
		for _, r := range recon.Deleted {
			if pruneEnabled {
				sec.Itemf("Deleted %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
			} else {
				sec.Itemf("Would delete %s: %s (%s)", r.Kind.String(), r.Slug, r.ResourceId)
			}
		}
		if len(recon.Created) == 0 && len(recon.Updated) == 0 && len(recon.Deleted) == 0 {
			sec.Item("No changes detected")
		}
	}

	out.Hintf("View project: stigmer get project %s", proj.Metadata.Name)
	if len(proj.Spec.Agents) > 0 {
		out.Hint("Run an agent: stigmer run agent <agent-name>")
	}
	if len(proj.Spec.Workflows) > 0 {
		out.Hint("Run a workflow: stigmer run workflow <workflow-name>")
	}
	out.Hint("Update and redeploy: edit code and run 'stigmer apply' again")
	return out
}

func buildMissingSkillsResult(missing []apply.ExternalSkillRef) *clioutput.CommandResult {
	result := clioutput.Warning("Deployment blocked: %d external skill(s) not found", len(missing))

	sec := result.AddSection("Missing Skills")
	for _, ref := range missing {
		if len(ref.ReferencedBy) > 0 {
			sec.Itemf("%s (referenced by: %s)", ref.String(), strings.Join(ref.ReferencedBy, ", "))
		} else {
			sec.Item(ref.String())
		}
	}
	fixes := result.AddSection("To fix, push each skill before deploying")
	for _, ref := range missing {
		org := ref.Org
		if org == "" {
			org = "<your-org>"
		}
		fixes.Itemf("stigmer skill push ./skills/%s --org %s", ref.Slug, org)
	}
	result.Hint("Then run 'stigmer apply' again.")
	return result
}
