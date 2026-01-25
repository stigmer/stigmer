package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewSkillCommand creates the skill management command group
func NewSkillCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Manage skills",
		Long: `Manage skill artifacts for AI agents.

Skills are reusable capabilities that extend agent functionality.
Each skill is a directory containing a SKILL.md definition file
and supporting implementation files.

Skills are versioned and stored in the Stigmer registry. They can be
referenced by agents using tags (e.g., "latest", "v1.0") or exact
version hashes for reproducible deployments.`,
	}

	cmd.AddCommand(newSkillPushCommand())
	// Future: cmd.AddCommand(newSkillListCommand())
	// Future: cmd.AddCommand(newSkillGetCommand())
	// Future: cmd.AddCommand(newSkillDeleteCommand())

	return cmd
}

// newSkillPushCommand creates the skill push subcommand
func newSkillPushCommand() *cobra.Command {
	var tag string
	var orgOverride string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "push [directory]",
		Short: "Push a skill artifact to the registry",
		Long: `Push a skill directory as an artifact to the Stigmer registry.

The directory must contain a SKILL.md file defining the skill interface.
All files (except .git, node_modules, .venv, etc.) are packaged into a
ZIP artifact and uploaded to the registry.

The skill name is derived from the directory name. A SHA256 hash is
calculated from the artifact contents for content-addressable storage
and deduplication.`,
		Example: `  # Push skill from current directory
  stigmer skill push

  # Push skill from specific directory
  stigmer skill push ./my-skill/

  # Push with a specific tag
  stigmer skill push --tag v1.0.0

  # Push to a specific organization
  stigmer skill push --org my-org

  # Dry run (validate without pushing)
  stigmer skill push --dry-run`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			// Determine directory
			directory, err := resolveSkillDirectory(args)
			clierr.Handle(err)

			// Execute push
			result, err := executeSkillPush(skillPushOptions{
				Directory:   directory,
				Tag:         tag,
				OrgOverride: orgOverride,
				DryRun:      dryRun,
			})
			clierr.Handle(err)

			// Display result
			if !dryRun && result != nil {
				displaySkillPushResult(result)
			}
		},
	}

	cmd.Flags().StringVar(&tag, "tag", "latest", "version tag for the skill")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without pushing")

	return cmd
}

// skillPushOptions contains options for the skill push operation
type skillPushOptions struct {
	Directory   string
	Tag         string
	OrgOverride string
	DryRun      bool
}

// resolveSkillDirectory determines the skill directory from args or current directory
func resolveSkillDirectory(args []string) (string, error) {
	if len(args) > 0 {
		return args[0], nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get current directory: %w", err)
	}
	return cwd, nil
}

// executeSkillPush handles the skill push operation
func executeSkillPush(opts skillPushOptions) (*artifact.SkillArtifactResult, error) {
	// Step 1: Validate SKILL.md exists
	if !artifact.HasSkillFile(opts.Directory) {
		return nil, fmt.Errorf("SKILL.md not found in %s\n\nA skill directory must contain a SKILL.md file defining the skill interface", opts.Directory)
	}

	cliprint.PrintInfo("Pushing skill from: %s", opts.Directory)
	fmt.Println()

	// Step 2: Dry run mode - just validate
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - would push skill with:")
		cliprint.PrintInfo("  Directory: %s", opts.Directory)
		cliprint.PrintInfo("  Tag:       %s", opts.Tag)
		return nil, nil
	}

	// Step 3: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 4: Determine organization based on backend mode
	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 5: Ensure daemon is running (local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 6: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")

	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	cliprint.PrintSuccess("✓ Connected to backend")
	fmt.Println()

	// Step 7: Push skill artifact
	result, err := artifact.PushSkill(&artifact.SkillArtifactOptions{
		Directory: opts.Directory,
		OrgID:     orgID,
		Tag:       opts.Tag,
		Conn:      conn,
		Quiet:     false,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// resolveOrganization determines the organization ID based on backend type and overrides
func resolveOrganization(cfg *config.Config, orgOverride string) (string, error) {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		orgID := "local"
		cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		return orgID, nil

	case config.BackendTypeCloud:
		if orgOverride != "" {
			cliprint.PrintInfo("Using organization from flag: %s", orgOverride)
			return orgOverride, nil
		}

		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			cliprint.PrintInfo("Using organization from context: %s", cfg.Backend.Cloud.OrgID)
			return cfg.Backend.Cloud.OrgID, nil
		}

		return "", fmt.Errorf("organization not set for cloud mode\n\nUse --org flag or run: stigmer context set --org <org-id>")

	default:
		return "", fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}
}

// displaySkillPushResult displays the result of a successful skill push
func displaySkillPushResult(result *artifact.SkillArtifactResult) {
	fmt.Println()
	cliprint.PrintSuccess("Skill pushed successfully!")
	fmt.Println()
	cliprint.PrintInfo("Skill Details:")
	cliprint.PrintInfo("  Name:         %s", result.SkillName)
	cliprint.PrintInfo("  Version Hash: %s", result.VersionHash)
	if result.Tag != "" {
		cliprint.PrintInfo("  Tag:          %s", result.Tag)
	}
	cliprint.PrintInfo("  Size:         %s", formatSkillBytes(result.ArtifactSize))
	fmt.Println()
	cliprint.PrintInfo("Next steps:")
	cliprint.PrintInfo("  - Reference this skill in your agent code")
	cliprint.PrintInfo("  - Update and re-push: edit files and run 'stigmer skill push' again")
	fmt.Println()
}

// formatSkillBytes formats a byte count into a human-readable string
func formatSkillBytes(bytes int64) string {
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
