package agent

// skillOptions holds configuration for skill reference creation in AddSkill methods.
type skillOptions struct {
	version string
}

// SkillOption configures skill reference creation in AddSkill methods.
type SkillOption func(*skillOptions)

// AtVersion sets the skill version for the reference.
//
// Version supports three formats:
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//   - "latest": explicitly use the latest version
//
// If not specified, the version field is left empty (resolved to "latest" by the platform).
//
// Example:
//
//	agent.AddSkill("web-search", AtVersion("v1.0"))
//	agent.AddSkill("code-review", AtVersion("stable"))
func AtVersion(v string) SkillOption {
	return func(o *skillOptions) {
		o.version = v
	}
}

// applySkillOptions applies all options and returns the resulting configuration.
func applySkillOptions(opts ...SkillOption) *skillOptions {
	o := &skillOptions{}
	for _, opt := range opts {
		opt(o)
	}
	return o
}
