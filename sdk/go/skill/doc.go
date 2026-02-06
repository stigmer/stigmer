// Package skill provides the Skill entity for defining skills in the SDK.
//
// Skills are content artifacts (like Docker images) - the user points to a source
// location (local directory or git repo), and the CLI fetches the content,
// creates a ZIP artifact, and pushes it to the backend.
//
// # Defining Skills (this package)
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
// # Referencing Existing Skills (ref package)
//
// To reference existing skills in agent configurations, use the ref package:
//
//	import "github.com/stigmer/stigmer/sdk/go/ref"
//
//	// Explicit org and slug
//	skillRef := ref.Skill("stigmer", "web-search")
//	skillRef := ref.Skill("stigmer", "code-review", ref.WithVersion("v1.0"))
//
//	// Parse from string
//	skillRef, err := ref.ParseSkill("stigmer/web-search@stable")
//
//	// Add to agent
//	agent.AddSkillRef(ref.Skill("stigmer", "web-search"))
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
