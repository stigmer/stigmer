package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// NewPushCommand creates the unified push command for pushing artifacts.
func NewPushCommand() *cobra.Command {
	var tag string
	var dryRun bool
	var gitURL string
	var gitRef string
	var gitSubdir string
	var ignorePatterns []string
	var includePatterns []string
	var noGitignore bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "push <type> [path]",
		Short: "Push an artifact to the registry",
		Long: `Push an artifact to the Stigmer registry.

The type can be specified using any alias:
  - skill, skills, skl

The path is optional and defaults to the current directory.

For skills, the directory must contain a SKILL.md file with YAML frontmatter 
defining the skill name. Files are filtered using gitignore-compatible patterns.

SOURCE MODES:
  Local Push:  Push from a local directory (default). Git info is auto-detected.
  Remote Push: Push directly from a GitHub URL using --git-url flag.`,
		Example: `  # Push skill from current directory
  stigmer push skill

  # Push skill from specific directory
  stigmer push skill ./my-skill/

  # Push with a specific tag
  stigmer push skill --tag v1.0.0

  # Push to a specific organization
  stigmer push skill --org my-org

  # Push from a GitHub repository
  stigmer push skill --git-url https://github.com/stigmer/stigmer.git --git-ref v1.0.0 --subdir seedpack/skills/skill-creator

  # Dry run (validate without pushing)
  stigmer push skill --dry-run

  # Ignore additional patterns
  stigmer push skill --ignore "*.tmp" --ignore "draft/**"

  # Force include specific files that would be ignored
  stigmer push skill --include ".env.example"

  # Don't respect .gitignore patterns
  stigmer push skill --no-gitignore

  # Show verbose output with ignore decisions
  stigmer push skill --verbose`,
		Args: cobra.RangeArgs(1, 2),
		Run: func(cmd *cobra.Command, args []string) {
			// Parse type and optional path
			typeArg := args[0]
			var path string
			if len(args) > 1 {
				path = args[1]
			}

			err := executePush(pushOptions{
				TypeArg:         typeArg,
				Path:            path,
				Tag:             tag,
				OrgOverride:     GetOrgFlag(cmd),
				DryRun:          dryRun,
				GitURL:          gitURL,
				GitRef:          gitRef,
				GitSubdir:       gitSubdir,
				IgnorePatterns:  ignorePatterns,
				IncludePatterns: includePatterns,
				NoGitignore:     noGitignore,
				Verbose:         verbose,
			})
			clierr.Handle(err)
		},
	}

	// Core flags
	cmd.Flags().StringVar(&tag, "tag", "latest", "version tag for the artifact")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without pushing")

	// Git source flags
	cmd.Flags().StringVar(&gitURL, "git-url", "", "push from a remote git repository URL")
	cmd.Flags().StringVar(&gitRef, "git-ref", "", "git reference (tag, branch, or commit SHA) for remote push")
	cmd.Flags().StringVar(&gitSubdir, "subdir", "", "subdirectory within git repository containing the artifact")

	// Ignore filtering flags
	cmd.Flags().StringArrayVar(&ignorePatterns, "ignore", nil, "additional patterns to ignore (can be repeated)")
	cmd.Flags().StringArrayVar(&includePatterns, "include", nil, "patterns to force-include (can be repeated)")
	cmd.Flags().BoolVar(&noGitignore, "no-gitignore", false, "don't respect .gitignore patterns")
	cmd.Flags().BoolVar(&verbose, "verbose", false, "show detailed output including ignore decisions")

	return cmd
}

// pushOptions contains options for the push command.
type pushOptions struct {
	TypeArg         string
	Path            string
	Tag             string
	OrgOverride     string
	DryRun          bool
	GitURL          string
	GitRef          string
	GitSubdir       string
	IgnorePatterns  []string
	IncludePatterns []string
	NoGitignore     bool
	Verbose         bool
}

// executePush validates type and routes to the appropriate push handler.
func executePush(opts pushOptions) error {
	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: skill", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbPush) {
		return formatUnsupportedVerbError(info, types.VerbPush)
	}

	// Step 3: Route to appropriate handler
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_skill:
		return pushSkill(opts)

	default:
		return fmt.Errorf("push not implemented for %s", info.DisplayName)
	}
}

// pushSkill handles skill push operations.
func pushSkill(opts pushOptions) error {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Step 2: Determine organization
	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
	}

	// Step 3: Ensure daemon is running (local mode only)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return err
		}
	}

	// Step 4: Connect to backend
	climsg.Info("Connecting to backend...")

	client, err := backend.NewStigmerClient()
	if err != nil {
		return err
	}
	defer client.Close()
	conn := client.Conn().(*grpc.ClientConn)

	climsg.Success("✓ Connected to backend")
	fmt.Println()

	// Step 5: Execute push based on mode
	if opts.GitURL != "" {
		return pushSkillRemote(opts, orgID, conn)
	}
	return pushSkillLocal(opts, orgID, conn)
}

// pushSkillLocal handles local directory push.
func pushSkillLocal(opts pushOptions, orgID string, conn *grpc.ClientConn) error {
	// Resolve directory
	directory := opts.Path
	if directory == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get current directory: %w", err)
		}
		directory = cwd
	}

	result, err := skill.Push(skill.PushOptions{
		Directory:       directory,
		OrgID:           orgID,
		Tag:             opts.Tag,
		DryRun:          opts.DryRun,
		IgnorePatterns:  opts.IgnorePatterns,
		IncludePatterns: opts.IncludePatterns,
		NoGitignore:     opts.NoGitignore,
		Verbose:         opts.Verbose,
		Conn:            conn,
	})
	if err != nil {
		return err
	}

	if !opts.DryRun && result != nil {
		skill.DisplayPushResult(result)
	}

	return nil
}

// pushSkillRemote handles remote git repository push.
func pushSkillRemote(opts pushOptions, orgID string, conn *grpc.ClientConn) error {
	result, err := skill.PushRemote(skill.RemotePushOptions{
		GitURL:          opts.GitURL,
		GitRef:          opts.GitRef,
		GitSubdir:       opts.GitSubdir,
		OrgID:           orgID,
		Tag:             opts.Tag,
		DryRun:          opts.DryRun,
		IgnorePatterns:  opts.IgnorePatterns,
		IncludePatterns: opts.IncludePatterns,
		NoGitignore:     opts.NoGitignore,
		Verbose:         opts.Verbose,
		Conn:            conn,
	})
	if err != nil {
		return err
	}

	if !opts.DryRun && result != nil {
		skill.DisplayPushResult(result)
	}

	return nil
}
