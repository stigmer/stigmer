// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// RemotePushOptions contains options for pushing from a remote git repository.
type RemotePushOptions struct {
	GitURL          string
	GitRef          string
	GitSubdir       string
	OrgID           string
	Tag             string
	DryRun          bool
	IgnorePatterns  []string
	IncludePatterns []string
	NoGitignore     bool
	Verbose         bool
	Client          *stigmer.Client
}

// PushRemote pushes a skill artifact from a remote git repository.
// It clones the repository, validates SKILL.md exists, and pushes to the registry.
func PushRemote(opts RemotePushOptions) (*artifact.SkillArtifactResult, error) {
	climsg.Info("Pushing skill from remote git repository")
	climsg.Info("  URL: %s", opts.GitURL)
	if opts.GitRef != "" {
		climsg.Info("  Ref: %s", opts.GitRef)
	}
	if opts.GitSubdir != "" {
		climsg.Info("  Subdir: %s", opts.GitSubdir)
	}
	fmt.Println()

	// Step 1: Dry run mode - show configuration
	if opts.DryRun {
		return displayRemoteDryRun(opts)
	}

	// Step 2: Clone repository and push
	return cloneAndPush(opts)
}

// displayRemoteDryRun shows what would happen without actually pushing.
func displayRemoteDryRun(opts RemotePushOptions) (*artifact.SkillArtifactResult, error) {
	climsg.Info("Dry run mode - would push skill with:")
	fmt.Println()
	climsg.Info("Git Source:")
	climsg.Info("  URL:    %s", opts.GitURL)
	if opts.GitRef != "" {
		climsg.Info("  Ref:    %s", opts.GitRef)
	}
	if opts.GitSubdir != "" {
		climsg.Info("  Subdir: %s", opts.GitSubdir)
	}
	climsg.Info("  Tag:    %s", opts.Tag)
	fmt.Println()

	climsg.Info("Ignore Configuration:")
	if opts.NoGitignore {
		climsg.Info("  Gitignore: disabled")
	} else {
		climsg.Info("  Gitignore: enabled (will respect .gitignore in repo)")
	}
	climsg.Info("  Security defaults: enabled")
	climsg.Info("  Stigmerignore: will load if present")
	if len(opts.IgnorePatterns) > 0 {
		climsg.Info("  Extra ignore: %v", opts.IgnorePatterns)
	}
	if len(opts.IncludePatterns) > 0 {
		climsg.Info("  Force include: %v", opts.IncludePatterns)
	}
	fmt.Println()

	climsg.Info("Note: Full analysis requires cloning the repository.")
	climsg.Info("Run without --dry-run to push the skill artifact.")
	return nil, nil
}

// cloneAndPush clones the git repository and pushes the skill artifact.
func cloneAndPush(opts RemotePushOptions) (*artifact.SkillArtifactResult, error) {
	// Step 1: Create temp directory for clone
	tempDir, err := os.MkdirTemp("", "stigmer-skill-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Step 2: Clone the repository
	if err := cloneRepository(opts.GitURL, opts.GitRef, tempDir); err != nil {
		return nil, err
	}

	// Step 3: Determine skill directory (repo root or subdir)
	skillDir := tempDir
	if opts.GitSubdir != "" {
		skillDir = filepath.Join(tempDir, opts.GitSubdir)
		if _, err := os.Stat(skillDir); os.IsNotExist(err) {
			return nil, fmt.Errorf("subdirectory '%s' not found in repository", opts.GitSubdir)
		}
	}

	// Step 4: Validate SKILL.md exists
	if !artifact.HasSkillFile(skillDir) {
		return nil, fmt.Errorf("SKILL.md not found in %s\n\nThe skill directory must contain a SKILL.md file with YAML frontmatter", skillDir)
	}

	// Step 5: Push skill artifact with GitSource and ignore options
	ignoreOpts := &artifact.IgnoreOptions{
		RespectGitignore: !opts.NoGitignore,
		ExtraIgnore:      opts.IgnorePatterns,
		ExtraInclude:     opts.IncludePatterns,
		Verbose:          opts.Verbose,
	}

	result, err := artifact.PushSkillFromGit(&artifact.SkillFromGitOptions{
		Directory: skillDir,
		OrgID:     opts.OrgID,
		Tag:       opts.Tag,
		Client:    opts.Client,
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

// cloneRepository clones a git repository with optional ref checkout.
func cloneRepository(gitURL, gitRef, destDir string) error {
	climsg.Info("Cloning repository...")

	// Try shallow clone first (faster for tags/branches)
	cloneArgs := []string{"clone", "--depth", "1"}
	if gitRef != "" {
		cloneArgs = append(cloneArgs, "--branch", gitRef)
	}
	cloneArgs = append(cloneArgs, gitURL, destDir)

	cloneCmd := exec.Command("git", cloneArgs...)
	cloneOutput, err := cloneCmd.CombinedOutput()
	if err != nil {
		// If --branch failed (e.g., commit SHA), try full clone then checkout
		if gitRef != "" && strings.Contains(string(cloneOutput), "Could not find remote branch") {
			return cloneWithCheckout(gitURL, gitRef, destDir, cloneOutput)
		}
		return fmt.Errorf("failed to clone repository: %w\n%s", err, string(cloneOutput))
	}

	climsg.Success("✓ Repository cloned")
	return nil
}

// cloneWithCheckout performs a full clone and checks out a specific ref.
// Used when shallow clone with --branch fails (e.g., for commit SHAs).
func cloneWithCheckout(gitURL, gitRef, destDir string, originalOutput []byte) error {
	climsg.Info("Branch not found, trying commit checkout...")

	// Full clone without depth limit for commit SHA
	cloneCmd := exec.Command("git", "clone", gitURL, destDir)
	if _, err := cloneCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to clone repository: %w\n%s", err, string(originalOutput))
	}

	// Checkout the specific commit
	checkoutCmd := exec.Command("git", "checkout", gitRef)
	checkoutCmd.Dir = destDir
	if _, err := checkoutCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to checkout ref '%s': %w", gitRef, err)
	}

	climsg.Success("✓ Repository cloned")
	return nil
}
