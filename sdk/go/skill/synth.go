package skill

import (
	"fmt"
	"sync"

	"buf.build/go/protovalidate"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
)

// validator is the global protovalidate validator instance.
var validator protovalidate.Validator

func init() {
	// Initialize validator once at package load time
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// Context is a minimal interface that represents a stigmer context.
// This allows the skill package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterSkill(*Skill)
}

// Skill represents a skill resource in the SDK for synthesis.
//
// Skills are content artifacts (like Docker images) - the user points to a source
// location (local directory or git repo), and the CLI fetches the content,
// creates a ZIP artifact, and pushes it to the backend.
//
// This struct captures the source information for SDK-to-CLI handover.
// The actual skill content (SKILL.md, name, description) is extracted by
// the CLI/backend from the artifact.
//
// Use skill.FromDir() or skill.FromGit() with stigmer.Run() to create a Skill:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    s, err := skill.FromDir(ctx, "./skills/calculator", skill.WithTag("stable"))
//	    return err
//	})
type Skill struct {
	// sourceType indicates whether this is a local or git source
	sourceType sourceType

	// localPath is the path to the local directory (for local source)
	localPath string

	// gitURL is the git repository URL (for git source)
	gitURL string

	// gitRef is the git reference - tag, branch, or commit (for git source)
	gitRef string

	// gitSubdir is the subdirectory within the git repo (for git source)
	gitSubdir string

	// tag is the optional version tag for this skill
	tag string

	// ctx is the context that this skill is registered with (optional)
	ctx Context

	// mu protects concurrent access to mutable fields
	mu sync.Mutex
}

// sourceType indicates the type of skill source
type sourceType int

const (
	sourceTypeLocal sourceType = iota
	sourceTypeGit
)

// synthOptions holds configuration for skill synthesis.
type synthOptions struct {
	tag string
}

// SynthOption configures skill synthesis.
type SynthOption func(*synthOptions)

// WithTag sets the version tag for the skill.
//
// Tags are mutable pointers that can be updated to reference new versions.
// Examples: "stable", "v1.0", "beta", "latest"
// If not provided, the version will only be accessible via its immutable hash.
func WithTag(tag string) SynthOption {
	return func(o *synthOptions) {
		o.tag = tag
	}
}

// FromDir creates a skill from a local directory.
//
// The directory must contain a SKILL.md file with the skill definition.
// The CLI will:
//  1. Read the directory and create a ZIP artifact
//  2. Auto-detect git provenance if the directory is within a git repo
//  3. Push the artifact to the backend via PushSkillRequest
//
// The path can be relative (to SDK project root) or absolute.
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    // From relative path
//	    calc, err := skill.FromDir(ctx, "./skills/calculator")
//	    if err != nil {
//	        return err
//	    }
//
//	    // From absolute path with tag
//	    search, err := skill.FromDir(ctx, "/home/user/web-search",
//	        skill.WithTag("stable"))
//	    if err != nil {
//	        return err
//	    }
//
//	    return nil
//	})
func FromDir(ctx Context, path string, opts ...SynthOption) (*Skill, error) {
	if path == "" {
		return nil, ErrPathRequired
	}

	o := &synthOptions{}
	for _, opt := range opts {
		opt(o)
	}

	s := &Skill{
		sourceType: sourceTypeLocal,
		localPath:  path,
		tag:        o.tag,
		ctx:        ctx,
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterSkill(s)
	}

	return s, nil
}

// gitOptions holds configuration for git source.
type gitOptions struct {
	ref    string
	subdir string
	tag    string
}

// GitOption configures git source for skill.
type GitOption func(*gitOptions)

// WithRef sets the git reference (tag, branch, or commit).
//
// If not provided, defaults to the repository's default branch (usually "main").
// The CLI resolves this to a commit SHA for provenance tracking.
//
// Examples: "v1.0.0", "main", "feature/new-skill", "abc123..."
func WithRef(ref string) GitOption {
	return func(o *gitOptions) {
		o.ref = ref
	}
}

// WithSubdir sets the subdirectory within the git repository.
//
// Use this when the SKILL.md is not at the repository root.
// Example: "skills/calculator"
func WithSubdir(subdir string) GitOption {
	return func(o *gitOptions) {
		o.subdir = subdir
	}
}

// WithGitTag sets the version tag for the skill (for git source).
//
// Tags are mutable pointers that can be updated to reference new versions.
// Examples: "stable", "v1.0", "beta", "latest"
func WithGitTag(tag string) GitOption {
	return func(o *gitOptions) {
		o.tag = tag
	}
}

// FromGit creates a skill from a remote git repository.
//
// The CLI will:
//  1. Clone the repository to a temp directory
//  2. Checkout the specified ref (or default branch)
//  3. Create a ZIP artifact from the specified subdirectory (or root)
//  4. Push the artifact to the backend with git provenance
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    // From git repo root
//	    calc, err := skill.FromGit(ctx, "https://github.com/stigmer/skills.git",
//	        skill.WithRef("v1.0.0"),
//	        skill.WithSubdir("skills/calculator"))
//	    if err != nil {
//	        return err
//	    }
//
//	    // From default branch
//	    search, err := skill.FromGit(ctx, "https://github.com/acme/web-search.git",
//	        skill.WithGitTag("stable"))
//	    if err != nil {
//	        return err
//	    }
//
//	    return nil
//	})
func FromGit(ctx Context, url string, opts ...GitOption) (*Skill, error) {
	if url == "" {
		return nil, ErrUrlRequired
	}

	o := &gitOptions{}
	for _, opt := range opts {
		opt(o)
	}

	s := &Skill{
		sourceType: sourceTypeGit,
		gitURL:     url,
		gitRef:     o.ref,
		gitSubdir:  o.subdir,
		tag:        o.tag,
		ctx:        ctx,
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterSkill(s)
	}

	return s, nil
}

// IsLocal returns true if this skill is from a local directory.
func (s *Skill) IsLocal() bool {
	return s.sourceType == sourceTypeLocal
}

// IsGit returns true if this skill is from a git repository.
func (s *Skill) IsGit() bool {
	return s.sourceType == sourceTypeGit
}

// LocalPath returns the local directory path.
// Returns empty string if this is not a local source.
func (s *Skill) LocalPath() string {
	return s.localPath
}

// GitURL returns the git repository URL.
// Returns empty string if this is not a git source.
func (s *Skill) GitURL() string {
	return s.gitURL
}

// GitRef returns the git reference (tag, branch, or commit).
// Returns empty string if not specified or not a git source.
func (s *Skill) GitRef() string {
	return s.gitRef
}

// GitSubdir returns the subdirectory within the git repository.
// Returns empty string if not specified or not a git source.
func (s *Skill) GitSubdir() string {
	return s.gitSubdir
}

// Tag returns the version tag for this skill.
// Returns empty string if not specified.
func (s *Skill) Tag() string {
	return s.tag
}

// String returns a string representation of the Skill.
func (s *Skill) String() string {
	if s.IsLocal() {
		if s.tag != "" {
			return "Skill(local=" + s.localPath + ", tag=" + s.tag + ")"
		}
		return "Skill(local=" + s.localPath + ")"
	}
	result := "Skill(git=" + s.gitURL
	if s.gitRef != "" {
		result += "@" + s.gitRef
	}
	if s.gitSubdir != "" {
		result += ", subdir=" + s.gitSubdir
	}
	if s.tag != "" {
		result += ", tag=" + s.tag
	}
	return result + ")"
}

// ToProto converts the SDK Skill to a SkillSynth proto message.
//
// This produces the synthesis handover message that is written to
// .stigmer/skill-N.pb and read by the CLI during apply.
//
// Example:
//
//	s, _ := skill.FromDir(ctx, "./skills/calculator", skill.WithTag("stable"))
//	proto, err := s.ToProto()
func (s *Skill) ToProto() (*skillv1.SkillSynth, error) {
	synth := &skillv1.SkillSynth{
		Tag: s.tag,
	}

	if s.IsLocal() && s.localPath != "" {
		synth.Source = &skillv1.SkillSynth_Local{
			Local: &skillv1.LocalDir{
				Path: s.localPath,
			},
		}
	} else if s.IsGit() && s.gitURL != "" {
		synth.Source = &skillv1.SkillSynth_Git{
			Git: &skillv1.Git{
				Url:    s.gitURL,
				Ref:    s.gitRef,
				Subdir: s.gitSubdir,
			},
		}
	} else {
		return nil, ErrSourceNil
	}

	// Validate the proto message against buf.validate rules
	if err := validator.Validate(synth); err != nil {
		return nil, fmt.Errorf("skill synth validation failed: %w", err)
	}

	return synth, nil
}
