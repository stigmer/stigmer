package root

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apply"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// executeSDKDryRun shows a preview of the SDK project configuration without
// executing synthesis or connecting to the backend.
func executeSDKDryRun(
	detectResult *project.DetectResult,
	runtime apply.Runtime,
	renderer clioutput.Renderer,
) error {
	result := clioutput.Success("Dry run: SDK project configuration is valid")

	sec := result.AddSection("Project")
	sec.Field("Name", detectResult.Project.Metadata.Name)
	sec.Field("Entry Point", detectResult.Project.Spec.EntryPoint)
	sec.Field("Runtime", string(runtime))

	entryPointPath := filepath.Join(detectResult.ConfigDir, detectResult.Project.Spec.EntryPoint)
	if _, err := os.Stat(entryPointPath); os.IsNotExist(err) {
		result.AddSection("Warning").
			Item(fmt.Sprintf("Entry point file not found: %s", detectResult.Project.Spec.EntryPoint))
	}

	result.Hint("Remove --dry-run to execute synthesis and apply resources")
	renderer.Render(result)
	return nil
}

// buildSDKResult constructs the structured output for a successful SDK apply.
func buildSDKResult(
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
	sec.Field("Mode", "SDK")
	if projectResult.Project.Metadata.Id != "" {
		sec.Field("ID", projectResult.Project.Metadata.Id)
	}

	counts := countMembersByKind(members)
	if len(counts) > 0 {
		memberSec := result.AddSection("Members Applied")
		kindOrder := []apiresourcekind.ApiResourceKind{
			apiresourcekind.ApiResourceKind_skill,
			apiresourcekind.ApiResourceKind_agent,
			apiresourcekind.ApiResourceKind_workflow,
			apiresourcekind.ApiResourceKind_mcp_server,
		}
		for _, kind := range kindOrder {
			if c, ok := counts[kind]; ok {
				memberSec.Fieldf(kind.String(), "%d", c)
			}
		}
	}

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
