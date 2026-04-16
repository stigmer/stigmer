package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// executeDeclarativeApply implements the declarative track:
//
//  1. Scan the project directory for YAML resource files and skill directories
//  2. Detect resource kinds in each YAML file
//  3. Push skill directories first (agents may reference these skills)
//  4. Apply each YAML resource individually via its own RPC
//  5. Collect ApiResourceReferences from all pushed/applied resources
//  6. Set collected references as Project.Spec.Members
//  7. Apply the project to register membership for reconciliation
//  8. Render the summary result
func executeDeclarativeApply(detectResult *project.DetectResult, opts projectApplyOptions) error {
	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)

	climsg.Info("Declarative mode: found %s", detectResult.ConfigPath)

	// Phase 1: Scan directory for resource files and skill directories
	resourceFiles, err := scanResourceFiles(detectResult.ConfigDir)
	if err != nil {
		return errors.Wrap(err, "failed to scan project directory")
	}

	skillDirs, err := scanSkillDirectories(detectResult.ConfigDir)
	if err != nil {
		return errors.Wrap(err, "failed to scan for skill directories")
	}

	if len(resourceFiles) == 0 && len(skillDirs) == 0 {
		renderer.Render(buildNoResourcesResult(detectResult.ConfigDir))
		return nil
	}

	// Phase 2: Detect resource kinds in all files
	var items []applyItem
	if len(resourceFiles) > 0 {
		items, err = detectResourceItems(resourceFiles)
		if err != nil {
			return err
		}
	}

	applier.SortByApplyOrder(items, func(item applyItem) apiresourcekind.ApiResourceKind {
		return item.typeInfo.ProtoKind
	})

	climsg.Info("Found %d resource(s) in %d file(s), %d skill(s)",
		len(items), len(resourceFiles), len(skillDirs))

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
	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	climsg.Info("Connected to backend")

	// Phase 5a: Push skill directories first (agents may reference these skills)
	var members []*apiresource.ApiResourceReference
	for _, skillDir := range skillDirs {
		ref, err := pushSkillDirectory(skillDir, client, orgID)
		if err != nil {
			return errors.Wrapf(err, "failed to push skill from %s", skillDir)
		}
		if ref != nil {
			members = append(members, ref)
		}
	}

	// Phase 5b: Apply each YAML resource and collect references
	fctx := &fileApplyContext{
		client:   client,
		orgID:    orgID,
		dryRun:   false,
		renderer: renderer,
		cfg:      cfg,
	}

	for _, item := range items {
		ref, err := applyResourceItem(item, fctx)
		if err != nil {
			return errors.Wrapf(err, "failed to apply %s from %s", item.typeInfo.DisplayName, item.filePath)
		}
		if ref != nil && types.IsProjectMemberKind(item.typeInfo.ProtoKind) {
			members = append(members, ref)
		}
	}

	// Phase 5c: Discover capabilities for any applied MCP servers
	discoverAppliedMcpServers(fctx)

	// Phase 6: Apply project with collected member references
	detectResult.Project.Spec.Members = members

	projectResult, err := project.Apply(&project.ApplyOptions{
		Project: detectResult.Project,
		OrgID:   orgID,
		Client:  client,
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

// scanResourceFiles finds all YAML files in the project directory and its
// immediate subdirectories, excluding stigmer.yaml and skill directories.
//
// Scans the top-level directory and one level of subdirectories. This supports
// both flat project layouts (agent.yaml next to stigmer.yaml) and organized
// layouts (agents/my-agent.yaml, mcp-servers/github.yaml).
//
// Skill directories are excluded at both levels:
//   - Immediate skill dirs (my-skill/SKILL.md) are skipped entirely
//   - Skill grouping dirs (skills/) that contain nested skill dirs are skipped
//     for YAML scanning since they're handled by scanSkillDirectories
func scanResourceFiles(projectDir string) ([]string, error) {
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read directory %s", projectDir)
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			subDir := filepath.Join(projectDir, entry.Name())
			if isSkillDirectory(subDir) {
				continue
			}
			if containsSkillDirectories(subDir) {
				continue
			}
			subFiles, err := collectYAMLFiles(subDir)
			if err != nil {
				return nil, errors.Wrapf(err, "failed to read subdirectory %s", subDir)
			}
			files = append(files, subFiles...)
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

// containsSkillDirectories returns true if any immediate child of dir is a
// skill directory (contains SKILL.md). Used to identify grouping directories
// like skills/ that should be excluded from YAML scanning.
func containsSkillDirectories(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.IsDir() && isSkillDirectory(filepath.Join(dir, entry.Name())) {
			return true
		}
	}
	return false
}

// collectYAMLFiles returns all YAML files directly within a directory (non-recursive).
func collectYAMLFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext == ".yaml" || ext == ".yml" {
			files = append(files, filepath.Join(dir, entry.Name()))
		}
	}
	return files, nil
}

// scanSkillDirectories finds subdirectories that contain a SKILL.md file.
//
// Supports two layouts:
//   - Flat:     projectDir/my-skill/SKILL.md        (immediate child)
//   - Organized: projectDir/skills/my-skill/SKILL.md (grandchild under a grouping dir)
//
// For each immediate subdirectory: if it contains SKILL.md, it's a skill dir.
// If not, its own children are checked (one level deeper). This supports
// organizing skills under a parent directory like skills/ without requiring
// deep recursive scanning.
func scanSkillDirectories(projectDir string) ([]string, error) {
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read directory %s", projectDir)
	}

	var skillDirs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		subDir := filepath.Join(projectDir, entry.Name())
		if isSkillDirectory(subDir) {
			skillDirs = append(skillDirs, subDir)
			continue
		}

		// Check grandchildren: supports skills/ grouping directory
		nested, err := scanNestedSkillDirectories(subDir)
		if err != nil {
			return nil, err
		}
		skillDirs = append(skillDirs, nested...)
	}

	return skillDirs, nil
}

// scanNestedSkillDirectories checks immediate children of dir for SKILL.md.
// This is the "one level deeper" scan for organized project layouts.
func scanNestedSkillDirectories(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read directory %s", dir)
	}

	var skillDirs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		subDir := filepath.Join(dir, entry.Name())
		if isSkillDirectory(subDir) {
			skillDirs = append(skillDirs, subDir)
		}
	}
	return skillDirs, nil
}

// isSkillDirectory returns true if the directory contains a SKILL.md file.
func isSkillDirectory(dir string) bool {
	return artifact.HasSkillFile(dir)
}

// pushSkillDirectory pushes a skill directory and returns an ApiResourceReference.
func pushSkillDirectory(dir string, client *stigmer.Client, orgID string) (*apiresource.ApiResourceReference, error) {
	climsg.Info("Pushing skill from %s...", filepath.Base(dir))

	result, err := skill.Push(skill.PushOptions{
		Directory: dir,
		OrgID:     orgID,
		Tag:       "latest",
		Client:    client,
	})
	if err != nil {
		return nil, err
	}

	return &apiresource.ApiResourceReference{
		Org:  orgID,
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: result.Slug,
	}, nil
}

// detectResourceItems detects the resource kind in each file and builds
// applyItems for resources that support the apply verb.
//
// Skipped kinds:
//   - Project: already loaded as stigmer.yaml
//   - Organization: sits above Project in the resource hierarchy
//     (Organization -> Project -> Members) and must be applied separately
//     via 'stigmer apply -f'. A project should never create its parent.
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

			if result.Kind == "Organization" {
				climsg.Warning("Skipping %s: Organization is not a project resource. Use 'stigmer apply -f' to manage organizations.", filePath)
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
		Item("Add YAML resource files (Agent, Workflow, McpServer) or skill directories (with SKILL.md) next to stigmer.yaml")
	result.Hint("Example: create agent.yaml with kind: Agent, or a skill directory with SKILL.md, then run 'stigmer apply'")
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
