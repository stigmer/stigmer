package subagent

// skillOptions holds configuration for skill reference creation in AddSkill methods.
type skillOptions struct {
	version string
}

// SkillOption configures skill reference creation in AddSkill methods.
//
// Options are applied in order, with later options overriding earlier ones.
// Version specified via options takes precedence over version in the reference string.
type SkillOption func(*skillOptions)

// AtVersion sets the skill version for the reference.
//
// Version supports multiple formats:
//   - Semantic version tag: e.g., "v1.0", "v2.1.3"
//   - Named tag: e.g., "stable", "beta", "latest"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//
// If not specified, the version field is left empty, which the platform
// resolves to "latest" at execution time.
//
// Note: Version specified via AtVersion() overrides any version in the
// reference string (e.g., "org/slug@v1.0" with AtVersion("v2.0") uses "v2.0").
//
// Example:
//
//	sub.AddSkill("stigmer/web-search", AtVersion("v1.0"))
//	sub.AddSkill("acme-corp/code-review", AtVersion("stable"))
func AtVersion(v string) SkillOption {
	return func(o *skillOptions) {
		o.version = v
	}
}

// applySkillOptions applies all options and returns the resulting configuration.
//
// This is an internal helper used by AddSkill and TryAddSkill methods.
func applySkillOptions(opts ...SkillOption) *skillOptions {
	o := &skillOptions{}
	for _, opt := range opts {
		opt(o)
	}
	return o
}
