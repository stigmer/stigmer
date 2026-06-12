// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

// PushOptions contains options for the skill push operation.
type PushOptions struct {
	Directory       string
	OrgID           string
	Tag             string
	Message         string
	DryRun          bool
	IgnorePatterns  []string
	IncludePatterns []string
	NoGitignore     bool
	Verbose         bool
	Client          *stigmer.Client
}

// Push pushes a skill artifact from a local directory to the registry.
// It validates the SKILL.md exists, optionally performs a dry run analysis,
// and pushes the artifact to the backend.
func Push(opts PushOptions) (*artifact.SkillArtifactResult, error) {
	// Step 1: Validate SKILL.md exists
	if !artifact.HasSkillFile(opts.Directory) {
		return nil, fmt.Errorf("SKILL.md not found in %s\n\nA skill directory must contain a SKILL.md file defining the skill interface", opts.Directory)
	}

	climsg.Info("Pushing skill from: %s", opts.Directory)
	fmt.Println()

	// Step 2: Dry run mode - analyze and show what would happen
	if opts.DryRun {
		return executeDryRun(opts)
	}

	// Step 3: Push skill artifact with ignore options
	ignoreOpts := &artifact.IgnoreOptions{
		RespectGitignore: !opts.NoGitignore,
		ExtraIgnore:      opts.IgnorePatterns,
		ExtraInclude:     opts.IncludePatterns,
		Verbose:          opts.Verbose,
	}

	result, err := artifact.PushSkill(&artifact.SkillArtifactOptions{
		Directory: opts.Directory,
		OrgID:     opts.OrgID,
		Tag:       opts.Tag,
		Message:   opts.Message,
		Client:    opts.Client,
		Quiet:     false,
		Ignore:    ignoreOpts,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// executeDryRun performs dry run analysis and displays what would happen.
func executeDryRun(opts PushOptions) (*artifact.SkillArtifactResult, error) {
	climsg.Info("Dry run mode - analyzing directory...")
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
	climsg.Info("Configuration:")
	climsg.Info("  Directory: %s", opts.Directory)
	climsg.Info("  Tag:       %s", opts.Tag)
	if opts.NoGitignore {
		climsg.Info("  Gitignore: disabled")
	}
	if len(opts.IgnorePatterns) > 0 {
		climsg.Info("  Extra ignore: %v", opts.IgnorePatterns)
	}
	if len(opts.IncludePatterns) > 0 {
		climsg.Info("  Force include: %v", opts.IncludePatterns)
	}
	fmt.Println()

	// Show pattern sources
	if len(analysis.PatternSources) > 0 {
		climsg.Info("Pattern sources:")
		for _, src := range analysis.PatternSources {
			climsg.Info("  - %s", src)
		}
		fmt.Println()
	}

	// Show summary
	climsg.Success("Would create artifact:")
	climsg.Info("  Files: %d included, %d ignored", analysis.Stats.FilesIncluded, analysis.Stats.FilesIgnored)
	climsg.Info("  Directories skipped: %d", analysis.Stats.DirsSkipped)
	climsg.Info("  Estimated size: %s", formatBytes(analysis.Stats.TotalSize))
	fmt.Println()

	// Show samples if verbose or if there are ignored items
	displayDryRunSamples(opts.Verbose, analysis)

	return nil, nil
}

// displayDryRunSamples shows sample included/ignored files from dry run analysis.
func displayDryRunSamples(verbose bool, analysis *artifact.DryRunAnalysis) {
	if verbose || len(analysis.SampleIgnored) > 0 {
		if len(analysis.SampleIgnored) > 0 {
			climsg.Info("Sample ignored (up to 10):")
			for _, item := range analysis.SampleIgnored {
				climsg.Info("  - %s", item)
			}
			fmt.Println()
		}
	}

	if verbose && len(analysis.SampleIncluded) > 0 {
		climsg.Info("Sample included (up to 10):")
		for _, item := range analysis.SampleIncluded {
			climsg.Info("  + %s", item)
		}
		fmt.Println()
	}
}

// DisplayPushResult displays the result of a successful skill push.
func DisplayPushResult(result *artifact.SkillArtifactResult) {
	fmt.Println()
	switch {
	case result.IsNewResource:
		climsg.Success("Skill created — new version %s", shortHash(result.VersionHash))
	case result.VersionChanged:
		climsg.Success("New version pushed — %s", shortHash(result.VersionHash))
	default:
		climsg.Success("No content changes — version unchanged (%s)", shortHash(result.VersionHash))
	}
	fmt.Println()
	climsg.Info("Skill Details:")
	climsg.Info("  Name:         %s", result.SkillName)
	climsg.Info("  Version Hash: %s", result.VersionHash)
	if result.Tag != "" {
		climsg.Info("  Tag:          %s", result.Tag)
	}
	if result.Message != "" {
		climsg.Info("  Message:      %s", result.Message)
	}
	climsg.Info("  Size:         %s", formatBytes(result.ArtifactSize))
	fmt.Println()
	climsg.Info("Next steps:")
	climsg.Info("  - Reference this skill in your agent code")
	climsg.Info("  - Update and re-push: edit files and run 'stigmer push skill' again")
	fmt.Println()
}

// shortHash renders a sha256 hash as a friendly, truncated identifier.
func shortHash(hash string) string {
	if hash == "" {
		return "sha256:(none)"
	}
	if len(hash) > 12 {
		return "sha256:" + hash[:12]
	}
	return "sha256:" + hash
}

// formatBytes formats a byte count into a human-readable string.
func formatBytes(bytes int64) string {
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
