package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// executeDeclarativeApply implements the declarative track:
//
//  1. Scan the project directory for YAML resource files (excluding stigmer.yaml)
//  2. Detect resource kinds in each file
//  3. Apply each resource individually via its own RPC
//  4. Collect ApiResourceReferences from successful applies
//  5. Set collected references as Project.Spec.Members
//  6. Apply the project to register membership for reconciliation
//  7. Render the summary result
func executeDeclarativeApply(detectResult *project.DetectResult, opts projectApplyOptions) error {
	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)

	climsg.Info("Declarative mode: found %s", detectResult.ConfigPath)

	// Phase 1: Scan directory for resource files
	resourceFiles, err := scanResourceFiles(detectResult.ConfigDir)
	if err != nil {
		return errors.Wrap(err, "failed to scan project directory")
	}

	if len(resourceFiles) == 0 {
		renderer.Render(buildNoResourcesResult(detectResult.ConfigDir))
		return nil
	}

	// Phase 2: Detect resource kinds in all files
	items, err := detectResourceItems(resourceFiles)
	if err != nil {
		return err
	}

	climsg.Info("Found %d resource(s) in %d file(s)", len(items), len(resourceFiles))

	// Phase 3: Dry-run renders previews without backend interaction
	if opts.DryRun {
		return executeDryRun(items, renderer)
	}

	// Phase 4: Establish backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveApplyOrganization(cfg, detectResult.Project, opts.OrgOverride)
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

	climsg.Info("Connecting to backend...")
	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()
	climsg.Info("Connected to backend")

	// Phase 5: Apply each resource and collect references
	fctx := &fileApplyContext{
		conn:     conn,
		orgID:    orgID,
		dryRun:   false,
		renderer: renderer,
	}

	var members []*apiresource.ApiResourceReference
	for _, item := range items {
		ref, err := applyResourceItem(item, fctx)
		if err != nil {
			return errors.Wrapf(err, "failed to apply %s from %s", item.typeInfo.DisplayName, item.filePath)
		}
		if ref != nil {
			members = append(members, ref)
		}
	}

	// Phase 6: Apply project with collected member references
	detectResult.Project.Spec.Members = members

	projectResult, err := project.Apply(&project.ApplyOptions{
		Project: detectResult.Project,
		OrgID:   orgID,
		Conn:    conn,
		Quiet:   false,
		DryRun:  false,
		Prune:   opts.PruneEnabled,
	})
	if err != nil {
		return errors.Wrap(err, "failed to apply project")
	}

	// Phase 7: Render final summary
	renderer.Render(buildDeclarativeResult(projectResult, members))
	return nil
}

// scanResourceFiles finds all YAML files in the project directory,
// excluding stigmer.yaml (the project marker file).
//
// Only scans the top-level directory — subdirectories are not traversed.
// This keeps the mental model simple: "files next to stigmer.yaml are resources."
func scanResourceFiles(projectDir string) ([]string, error) {
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read directory %s", projectDir)
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		if strings.ToLower(name) == project.ConfigFileName {
			continue
		}

		files = append(files, filepath.Join(projectDir, name))
	}

	return files, nil
}

// detectResourceItems detects the resource kind in each file and builds
// applyItems for resources that support the apply verb.
// Files containing Project kind are silently skipped (already loaded as stigmer.yaml).
func detectResourceItems(files []string) ([]applyItem, error) {
	reg := types.DefaultRegistry()
	var items []applyItem

	for _, filePath := range files {
		results, err := types.DetectMulti(filePath)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to detect resource kind in %s", filePath)
		}

		for _, result := range results {
			if result.Kind == "Project" {
				continue
			}

			info, ok := reg.GetByYAMLKind(result.Kind)
			if !ok {
				return nil, fmt.Errorf("unknown resource kind %q in %s", result.Kind, filePath)
			}
			if !info.SupportsVerb(types.VerbApply) {
				return nil, formatUnsupportedVerbError(info, types.VerbApply)
			}

			items = append(items, applyItem{
				filePath:   filePath,
				kind:       result.Kind,
				typeInfo:   info,
				rawContent: result.RawContent,
			})
		}
	}

	return items, nil
}

// executeDryRun validates all resources without applying, using the same
// per-resource handlers as the real flow (which render dry-run previews).
func executeDryRun(items []applyItem, renderer clioutput.Renderer) error {
	fctx := &fileApplyContext{
		dryRun:   true,
		renderer: renderer,
	}

	for _, item := range items {
		if _, err := applyResourceItem(item, fctx); err != nil {
			return errors.Wrapf(err, "dry-run validation failed for %s from %s",
				item.typeInfo.DisplayName, item.filePath)
		}
	}

	renderer.Render(buildDryRunSummary(len(items)))
	return nil
}

// =============================================================================
// Result Builders
// =============================================================================

func buildNoResourcesResult(projectDir string) *clioutput.CommandResult {
	result := clioutput.Warning("No resource files found in project directory")
	result.AddSection("").
		Fieldf("Directory", "%s", projectDir).
		Item("Add YAML resource files (Agent, Workflow, McpServer) next to stigmer.yaml")
	result.Hint("Example: create agent.yaml with kind: Agent, then run 'stigmer apply'")
	return result
}

func buildDryRunSummary(resourceCount int) *clioutput.CommandResult {
	result := clioutput.Success("Dry run complete: %d resource(s) validated", resourceCount)
	result.Hint("Remove --dry-run to apply resources to the backend")
	return result
}

func buildDeclarativeResult(
	projectResult *project.ApplyResult,
	members []*apiresource.ApiResourceReference,
) *clioutput.CommandResult {
	action := "updated"
	if projectResult.Created {
		action = "created"
	}

	result := clioutput.Success("Project %s successfully (%s)", projectResult.Project.Metadata.Name, action)

	sec := result.AddSection("Project")
	sec.Field("Name", projectResult.Project.Metadata.Name)
	sec.Field("Slug", projectResult.Project.Metadata.Slug)
	if projectResult.Project.Metadata.Id != "" {
		sec.Field("ID", projectResult.Project.Metadata.Id)
	}

	// Member summary by kind
	counts := countMembersByKind(members)
	if len(counts) > 0 {
		memberSec := result.AddSection("Members Applied")
		kindOrder := []apiresourcekind.ApiResourceKind{
			apiresourcekind.ApiResourceKind_agent,
			apiresourcekind.ApiResourceKind_workflow,
			apiresourcekind.ApiResourceKind_mcp_server,
			apiresourcekind.ApiResourceKind_skill,
		}
		for _, kind := range kindOrder {
			if c, ok := counts[kind]; ok {
				memberSec.Fieldf(kind.String(), "%d", c)
			}
		}
	}

	// Reconciliation summary if available
	if projectResult.Project.Status != nil && projectResult.Project.Status.LastReconciliation != nil {
		recon := projectResult.Project.Status.LastReconciliation
		if len(recon.Created) > 0 || len(recon.Updated) > 0 || len(recon.Deleted) > 0 {
			reconSec := result.AddSection("Reconciliation")
			if len(recon.Created) > 0 {
				reconSec.Fieldf("Created", "%d", len(recon.Created))
			}
			if len(recon.Updated) > 0 {
				reconSec.Fieldf("Updated", "%d", len(recon.Updated))
			}
			if len(recon.Deleted) > 0 {
				reconSec.Fieldf("Pruned", "%d", len(recon.Deleted))
			}
		}
	}

	result.Hintf("View project: stigmer get project %s", projectResult.Project.Metadata.Slug)
	return result
}

func countMembersByKind(members []*apiresource.ApiResourceReference) map[apiresourcekind.ApiResourceKind]int {
	counts := make(map[apiresourcekind.ApiResourceKind]int)
	for _, m := range members {
		counts[m.Kind]++
	}
	return counts
}
