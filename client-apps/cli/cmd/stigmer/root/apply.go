package root

import (
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// NewApplyCommand creates the apply command for deploying resources.
// Supports three modes:
//   - File mode (-f flag): Apply resources from YAML files with auto-detection
//   - Declarative mode: stigmer.yaml without entry_point, scans for YAML resources
//   - SDK mode: stigmer.yaml with entry_point, runs SDK synthesis
func NewApplyCommand() *cobra.Command {
	var dryRun bool
	var configDir string
	var pruneEnabled bool
	var filePath string
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Apply resources from files or project",
		Long: `Apply resources to the Stigmer backend.

MODES:

  File mode (with -f):     Apply individual YAML resource files
  Declarative mode:        Detect stigmer.yaml, scan for resources, apply with project tracking
  SDK mode:                Run SDK entry point for programmatic resource synthesis

Without -f, the CLI looks for stigmer.yaml in the current directory (or --config path).
If entry_point is set in stigmer.yaml, SDK mode is used. Otherwise, declarative mode
scans the directory for YAML resource files and applies each individually.

FILE MODE supports:
  - Agent, Workflow, McpServer resources
  - Directory paths (applies all .yaml/.yml files)
  - Multi-document YAML (--- separated)

DECLARATIVE MODE supports:
  - All file mode resource kinds in a project directory
  - Automatic resource discovery and membership tracking
  - Orphan pruning with --prune flag`,
		Example: `  # File mode - apply from YAML file
  stigmer apply -f agent.yaml
  stigmer apply -f workflow.yaml --dry-run
  stigmer apply -f ./manifests/  # directory

  # Declarative mode - deploy from stigmer.yaml project directory
  stigmer apply                       # scans cwd for resources
  stigmer apply --config /path/to/project/
  stigmer apply --dry-run
  stigmer apply --prune=false         # skip orphan deletion`,
		Run: func(cmd *cobra.Command, args []string) {
			var err error
			format := resolveResultFormat(jsonOutput, quietOutput)
			orgOverride := GetOrgFlag(cmd)

			if filePath != "" {
				err = executeFileApply(fileApplyOptions{
					FilePath:     filePath,
					OrgOverride:  orgOverride,
					DryRun:       dryRun,
					OutputFormat: format,
				})
			} else {
				renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

				detectResult, detectErr := project.DetectTrack(&project.DetectOptions{
					StartDir: configDir,
				})
				if detectErr != nil {
					clierr.Handle(errors.Wrap(detectErr, "track detection failed"))
					return
				}

				switch detectResult.Track {
				case project.TrackAtomic:
					renderer.Render(buildAtomicTrackResult())
				case project.TrackDeclarative:
					err = executeDeclarativeApply(detectResult, projectApplyOptions{
						ConfigDir:    configDir,
						OrgOverride:  orgOverride,
						DryRun:       dryRun,
						PruneEnabled: pruneEnabled,
						OutputFormat: format,
					})
				case project.TrackProject:
					err = executeProjectApply(detectResult, projectApplyOptions{
						ConfigDir:    configDir,
						OrgOverride:  orgOverride,
						DryRun:       dryRun,
						PruneEnabled: pruneEnabled,
						OutputFormat: format,
					})
				}
			}

			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&filePath, "file", "f", "", "path to YAML file or directory")
	cmd.Flags().StringVar(&configDir, "config", "", "path to project directory (project mode)")
	cmd.Flags().BoolVar(&pruneEnabled, "prune", true, "delete orphaned resources (project mode)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

type projectApplyOptions struct {
	ConfigDir    string
	OrgOverride  string
	DryRun       bool
	PruneEnabled bool
	OutputFormat clioutput.OutputFormat
}

// resolveApplyOrganization determines the organization ID for deployment.
// Priority: --org flag > stigmer.yaml metadata.org > CLI context > error.
// The same chain applies regardless of backend type (local or cloud).
func resolveApplyOrganization(cfg *config.Config, proj *projectv1.Project, override string) (string, error) {
	if override != "" {
		fmt.Fprintf(os.Stderr, "Using organization from flag: %s\n", override)
		return override, nil
	}

	if proj.Metadata != nil && proj.Metadata.Org != "" {
		fmt.Fprintf(os.Stderr, "Using organization from stigmer.yaml: %s\n", proj.Metadata.Org)
		return proj.Metadata.Org, nil
	}

	if ctxOrg := cfg.ResolveContextOrganization(); ctxOrg != "" {
		fmt.Fprintf(os.Stderr, "Using organization from context: %s\n", ctxOrg)
		return ctxOrg, nil
	}

	return "", errors.New("organization not set\n\n" +
		"Specify organization in one of these ways:\n" +
		"  1. Set metadata.org in stigmer.yaml\n" +
		"  2. Use --org flag: stigmer apply --org <org-id>\n" +
		"  3. Set context: stigmer config context set --org <org-id>")
}

func buildAtomicTrackResult() *clioutput.CommandResult {
	result := clioutput.Warning("No stigmer.yaml found in current directory or parents")
	result.AddSection("").
		Item("The 'stigmer apply' command requires a project with stigmer.yaml").
		Item("This enables resource discovery and project-based reconciliation")
	result.AddSection("For single-resource deployment, use file mode").
		Item("stigmer apply -f agent.yaml").
		Item("stigmer apply -f workflow.yaml").
		Item("stigmer apply -f mcpserver.yaml")
	result.Hint("To create a new project: create stigmer.yaml with your project name, add YAML resource files, run 'stigmer apply'")
	return result
}
