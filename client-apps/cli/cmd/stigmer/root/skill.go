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
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewSkillCommand creates a deprecated skill command group.
// All skill commands have been migrated to verb-first pattern.
func NewSkillCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:        "skill",
		Aliases:    []string{"skl"},
		Short:      "[DEPRECATED] Use verb-first commands instead",
		Deprecated: "All skill commands have been migrated to verb-first pattern.",
		Long: `DEPRECATED: All skill commands have been migrated to verb-first pattern.

Use these commands instead:

  stigmer push skill [path]        # Push skill artifact to registry
  stigmer get skill <name>         # Get skill details
  stigmer list skills              # List all skills
  stigmer delete skill <name>      # Delete a skill

The verb-first pattern provides consistency across all resource types
and better discoverability.`,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println()
			fmt.Println("DEPRECATED: All skill commands have been migrated to verb-first pattern.")
			fmt.Println()
			fmt.Println("Use these commands instead:")
			fmt.Println("  stigmer push skill [path]        # Push skill artifact to registry")
			fmt.Println("  stigmer get skill <name>         # Get skill details")
			fmt.Println("  stigmer list skills              # List all skills")
			fmt.Println("  stigmer delete skill <name>      # Delete a skill")
			fmt.Println()
		},
	}

	return cmd
}

// skillPushOptions contains options for the skill push operation
type skillPushOptions struct {
	Directory       string
	Tag             string
	OrgOverride     string
	DryRun          bool
	IgnorePatterns  []string
	IncludePatterns []string
	NoGitignore     bool
	Verbose         bool
}

// remotePushOptions contains options for pushing from a remote git repository
type remotePushOptions struct {
	GitURL          string
	GitRef          string
	GitSubdir       string
	Tag             string
	OrgOverride     string
	DryRun          bool
	IgnorePatterns  []string
	IncludePatterns []string
	NoGitignore     bool
	Verbose         bool
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

	// Step 1: Dry run mode - show configuration
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - would push skill with:")
		fmt.Println()
		cliprint.PrintInfo("Git Source:")
		cliprint.PrintInfo("  URL:    %s", opts.GitURL)
		if opts.GitRef != "" {
			cliprint.PrintInfo("  Ref:    %s", opts.GitRef)
		}
		if opts.GitSubdir != "" {
			cliprint.PrintInfo("  Subdir: %s", opts.GitSubdir)
		}
		cliprint.PrintInfo("  Tag:    %s", opts.Tag)
		fmt.Println()

		cliprint.PrintInfo("Ignore Configuration:")
		if opts.NoGitignore {
			cliprint.PrintInfo("  Gitignore: disabled")
		} else {
			cliprint.PrintInfo("  Gitignore: enabled (will respect .gitignore in repo)")
		}
		cliprint.PrintInfo("  Security defaults: enabled")
		cliprint.PrintInfo("  Stigmerignore: will load if present")
		if len(opts.IgnorePatterns) > 0 {
			cliprint.PrintInfo("  Extra ignore: %v", opts.IgnorePatterns)
		}
		if len(opts.IncludePatterns) > 0 {
			cliprint.PrintInfo("  Force include: %v", opts.IncludePatterns)
		}
		fmt.Println()

		cliprint.PrintInfo("Note: Full analysis requires cloning the repository.")
		cliprint.PrintInfo("Run without --dry-run to push the skill artifact.")
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

	// Step 10: Push skill artifact with GitSource and ignore options
	ignoreOpts := &artifact.IgnoreOptions{
		RespectGitignore: !opts.NoGitignore,
		ExtraIgnore:      opts.IgnorePatterns,
		ExtraInclude:     opts.IncludePatterns,
		Verbose:          opts.Verbose,
	}

	result, err := artifact.PushSkillFromGit(&artifact.SkillFromGitOptions{
		Directory: skillDir,
		OrgID:     orgID,
		Tag:       opts.Tag,
		Conn:      conn,
		Quiet:     false,
		GitURL:    opts.GitURL,
		GitRef:    opts.GitRef,
		GitSubdir: opts.GitSubdir,
		Ignore:    ignoreOpts,
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

	// Step 2: Dry run mode - analyze and show what would happen
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - analyzing directory...")
		fmt.Println()

		ignoreOpts := artifact.IgnoreOptions{
			RespectGitignore: !opts.NoGitignore,
			ExtraIgnore:      opts.IgnorePatterns,
			ExtraInclude:     opts.IncludePatterns,
			Verbose:          opts.Verbose,
		}

		analysis, err := artifact.AnalyzeDryRun(opts.Directory, ignoreOpts)
		if err != nil {
			return nil, fmt.Errorf("dry run analysis failed: %w", err)
		}

		// Show configuration
		cliprint.PrintInfo("Configuration:")
		cliprint.PrintInfo("  Directory: %s", opts.Directory)
		cliprint.PrintInfo("  Tag:       %s", opts.Tag)
		if opts.NoGitignore {
			cliprint.PrintInfo("  Gitignore: disabled")
		}
		if len(opts.IgnorePatterns) > 0 {
			cliprint.PrintInfo("  Extra ignore: %v", opts.IgnorePatterns)
		}
		if len(opts.IncludePatterns) > 0 {
			cliprint.PrintInfo("  Force include: %v", opts.IncludePatterns)
		}
		fmt.Println()

		// Show pattern sources
		if len(analysis.PatternSources) > 0 {
			cliprint.PrintInfo("Pattern sources:")
			for _, src := range analysis.PatternSources {
				cliprint.PrintInfo("  - %s", src)
			}
			fmt.Println()
		}

		// Show summary
		cliprint.PrintSuccess("Would create artifact:")
		cliprint.PrintInfo("  Files: %d included, %d ignored", analysis.Stats.FilesIncluded, analysis.Stats.FilesIgnored)
		cliprint.PrintInfo("  Directories skipped: %d", analysis.Stats.DirsSkipped)
		cliprint.PrintInfo("  Estimated size: %s", formatSkillBytes(analysis.Stats.TotalSize))
		fmt.Println()

		// Show samples if verbose or if there are ignored items
		if opts.Verbose || len(analysis.SampleIgnored) > 0 {
			if len(analysis.SampleIgnored) > 0 {
				cliprint.PrintInfo("Sample ignored (up to 10):")
				for _, item := range analysis.SampleIgnored {
					cliprint.PrintInfo("  - %s", item)
				}
				fmt.Println()
			}
		}

		if opts.Verbose && len(analysis.SampleIncluded) > 0 {
			cliprint.PrintInfo("Sample included (up to 10):")
			for _, item := range analysis.SampleIncluded {
				cliprint.PrintInfo("  + %s", item)
			}
			fmt.Println()
		}

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

	// Step 7: Push skill artifact with ignore options
	ignoreOpts := &artifact.IgnoreOptions{
		RespectGitignore: !opts.NoGitignore,
		ExtraIgnore:      opts.IgnorePatterns,
		ExtraInclude:     opts.IncludePatterns,
		Verbose:          opts.Verbose,
	}

	result, err := artifact.PushSkill(&artifact.SkillArtifactOptions{
		Directory: opts.Directory,
		OrgID:     orgID,
		Tag:       opts.Tag,
		Conn:      conn,
		Quiet:     false,
		Ignore:    ignoreOpts,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
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
