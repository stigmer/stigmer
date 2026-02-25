package root

import (
	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
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

	cmd.Flags().StringVarP(&filePath, "file", "f", "", "path to YAML file or directory")
	cmd.Flags().StringVar(&configDir, "config", "", "path to project directory (project mode)")
	cmd.Flags().BoolVar(&pruneEnabled, "prune", true, "delete orphaned resources (project mode)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")

	return cmd
}

type projectApplyOptions struct {
	ConfigDir    string
	OrgOverride  string
	DryRun       bool
	PruneEnabled bool
}

// resolveApplyOrganization determines the organization ID for deployment.
// Uses cliprint for informational progress (kept as-is -- shared pattern).
func resolveApplyOrganization(cfg *config.Config, proj *projectv1.Project, override string) (string, error) {
	if override != "" {
		cliprint.PrintInfo("Using organization from flag: %s", override)
		return override, nil
	}

	if proj.Metadata != nil && proj.Metadata.Org != "" {
		cliprint.PrintInfo("Using organization from stigmer.yaml: %s", proj.Metadata.Org)
		return proj.Metadata.Org, nil
	}

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

	cliprint.PrintInfo("Using local backend (organization: local)")
	return "local", nil
}

func getEntryPoint(proj *projectv1.Project) string {
	if proj.Spec != nil && proj.Spec.EntryPoint != "" {
		return proj.Spec.EntryPoint
	}
	return getDefaultEntryPointForApply(proj.Spec.Runtime)
}

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
