// Package skill provides the Skill entity for defining and referencing skills in the SDK.
//
// This package supports two use cases:
//  1. DEFINING new skills via FromDir() or FromGit() for synthesis and deployment
//  2. REFERENCING existing skills via New(), Parse(), or MustParse() for agent configuration
//
// # Defining Skills
//
// Use FromDir() to create a skill from a local directory:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    calc, err := skill.FromDir(ctx, "./skills/calculator",
//	        skill.WithTag("stable"))
//	    if err != nil {
//	        return err
//	    }
//	    return nil
//	})
//
// Use FromGit() to create a skill from a remote git repository:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    search, err := skill.FromGit(ctx, "https://github.com/stigmer/skills.git",
//	        skill.WithRef("v1.0"),
//	        skill.WithSubdir("skills/web-search"),
//	        skill.WithGitTag("stable"))
//	    if err != nil {
//	        return err
//	    }
//	    return nil
//	})
//
// # Referencing Existing Skills
//
// Use New() or Parse() to reference existing skills in agent configurations:
//
//	// Explicit org and slug
//	ref := skill.New("stigmer", "web-search")
//	ref := skill.New("stigmer", "code-review", skill.WithVersion("v1.0"))
//
//	// Parse from string
//	ref, err := skill.Parse("stigmer/web-search@stable")
//
// # Synthesis Flow
//
// When you call skill.FromDir() or skill.FromGit(), the SDK:
//  1. Creates a Skill entity with source information
//  2. Registers it with the stigmer.Context
//  3. During synthesis, writes a SkillSynth proto to .stigmer/skill-N.pb
//
// The CLI then:
//  1. Reads SkillSynth from .stigmer/skill-N.pb
//  2. Fetches content from the source (local dir or git clone)
//  3. Creates a ZIP artifact
//  4. Detects git provenance (if applicable)
//  5. Calls PushSkillRequest to upload to backend
package skill
