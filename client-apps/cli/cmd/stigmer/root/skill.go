package root

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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
	var gitURL string
	var gitRef string
	var gitSubdir string

	cmd := &cobra.Command{
		Use:   "push [directory]",
		Short: "Push a skill artifact to the registry",
		Long: `Push a skill directory as an artifact to the Stigmer registry.

The directory must contain a SKILL.md file with YAML frontmatter defining
the skill name. All files (except .git, node_modules, .venv, etc.) are
packaged into a ZIP artifact and uploaded to the registry.

The skill name is extracted from the SKILL.md YAML frontmatter 'name' field.
A SHA256 hash is calculated from the artifact contents for content-addressable
storage and deduplication.

SOURCE MODES:
  Local Push:  Push from a local directory (default). Git info is auto-detected.
  Remote Push: Push directly from a GitHub URL using --git-url flag.`,
		Example: `  # Push skill from current directory
  stigmer skill push

  # Push skill from specific directory
  stigmer skill push ./my-skill/

  # Push with a specific tag
  stigmer skill push --tag v1.0.0

  # Push to a specific organization
  stigmer skill push --org my-org

  # Push from a GitHub repository
  stigmer skill push --git-url https://github.com/stigmer/skills.git --git-ref v1.0.0 --subdir skills/calculator

  # Dry run (validate without pushing)
  stigmer skill push --dry-run`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			var result *artifact.SkillArtifactResult
			var err error

			// Check if remote push mode (--git-url provided)
			if gitURL != "" {
				result, err = executeRemoteSkillPush(remotePushOptions{
					GitURL:      gitURL,
					GitRef:      gitRef,
					GitSubdir:   gitSubdir,
					Tag:         tag,
					OrgOverride: orgOverride,
					DryRun:      dryRun,
				})
			} else {
				// Local push mode
				directory, dirErr := resolveSkillDirectory(args)
				clierr.Handle(dirErr)

				result, err = executeSkillPush(skillPushOptions{
					Directory:   directory,
					Tag:         tag,
					OrgOverride: orgOverride,
					DryRun:      dryRun,
				})
			}
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
	cmd.Flags().StringVar(&gitURL, "git-url", "", "push from a remote git repository URL")
	cmd.Flags().StringVar(&gitRef, "git-ref", "", "git reference (tag, branch, or commit SHA) for remote push")
	cmd.Flags().StringVar(&gitSubdir, "subdir", "", "subdirectory within git repository containing SKILL.md")

	return cmd
}

// skillPushOptions contains options for the skill push operation
type skillPushOptions struct {
	Directory   string
	Tag         string
	OrgOverride string
	DryRun      bool
}

// remotePushOptions contains options for pushing from a remote git repository
type remotePushOptions struct {
	GitURL      string
	GitRef      string
	GitSubdir   string
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

// executeRemoteSkillPush handles pushing a skill from a remote git repository
func executeRemoteSkillPush(opts remotePushOptions) (*artifact.SkillArtifactResult, error) {
	cliprint.PrintInfo("Pushing skill from remote git repository")
	cliprint.PrintInfo("  URL: %s", opts.GitURL)
	if opts.GitRef != "" {
		cliprint.PrintInfo("  Ref: %s", opts.GitRef)
	}
	if opts.GitSubdir != "" {
		cliprint.PrintInfo("  Subdir: %s", opts.GitSubdir)
	}
	fmt.Println()

	// Step 1: Dry run mode - just validate
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - would push skill with:")
		cliprint.PrintInfo("  Git URL: %s", opts.GitURL)
		cliprint.PrintInfo("  Git Ref: %s", opts.GitRef)
		cliprint.PrintInfo("  Subdir:  %s", opts.GitSubdir)
		cliprint.PrintInfo("  Tag:     %s", opts.Tag)
		return nil, nil
	}

	// Step 2: Create temp directory for clone
	tempDir, err := os.MkdirTemp("", "stigmer-skill-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	cliprint.PrintInfo("Cloning repository...")

	// Step 3: Clone the repository (shallow clone for speed)
	cloneArgs := []string{"clone", "--depth", "1"}
	if opts.GitRef != "" {
		// For tags/branches, use --branch
		cloneArgs = append(cloneArgs, "--branch", opts.GitRef)
	}
	cloneArgs = append(cloneArgs, opts.GitURL, tempDir)

	cloneCmd := exec.Command("git", cloneArgs...)
	cloneOutput, err := cloneCmd.CombinedOutput()
	if err != nil {
		// If --branch failed (e.g., commit SHA), try full clone then checkout
		if opts.GitRef != "" && strings.Contains(string(cloneOutput), "Could not find remote branch") {
			cliprint.PrintInfo("Branch not found, trying commit checkout...")

			// Full clone without depth limit for commit SHA
			cloneCmd = exec.Command("git", "clone", opts.GitURL, tempDir)
			if _, err := cloneCmd.CombinedOutput(); err != nil {
				return nil, fmt.Errorf("failed to clone repository: %w\n%s", err, string(cloneOutput))
			}

			// Checkout the specific commit
			checkoutCmd := exec.Command("git", "checkout", opts.GitRef)
			checkoutCmd.Dir = tempDir
			if _, err := checkoutCmd.CombinedOutput(); err != nil {
				return nil, fmt.Errorf("failed to checkout ref '%s': %w", opts.GitRef, err)
			}
		} else {
			return nil, fmt.Errorf("failed to clone repository: %w\n%s", err, string(cloneOutput))
		}
	}

	cliprint.PrintSuccess("✓ Repository cloned")

	// Step 4: Determine skill directory (repo root or subdir)
	skillDir := tempDir
	if opts.GitSubdir != "" {
		skillDir = filepath.Join(tempDir, opts.GitSubdir)
		if _, err := os.Stat(skillDir); os.IsNotExist(err) {
			return nil, fmt.Errorf("subdirectory '%s' not found in repository", opts.GitSubdir)
		}
	}

	// Step 5: Validate SKILL.md exists
	if !artifact.HasSkillFile(skillDir) {
		return nil, fmt.Errorf("SKILL.md not found in %s\n\nThe skill directory must contain a SKILL.md file with YAML frontmatter", skillDir)
	}

	// Step 6: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 7: Determine organization
	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 8: Ensure daemon is running (local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 9: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")

	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	cliprint.PrintSuccess("✓ Connected to backend")
	fmt.Println()

	// Step 10: Push skill artifact with GitSource
	result, err := artifact.PushSkillFromGit(&artifact.SkillFromGitOptions{
		Directory: skillDir,
		OrgID:     orgID,
		Tag:       opts.Tag,
		Conn:      conn,
		Quiet:     false,
		GitURL:    opts.GitURL,
		GitRef:    opts.GitRef,
		GitSubdir: opts.GitSubdir,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
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
