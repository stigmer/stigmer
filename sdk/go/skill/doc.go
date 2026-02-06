// Package skill provides the Skill entity for defining skills in the SDK.
//
// This package is for DEFINING new skills that will be synthesized and applied.
// For REFERENCING existing skills, use the skillref package instead.
//
// # Domain Concept
//
// skill creates Skill entities - full resource definitions with configuration
// that are registered with a context and synthesized to the .stigmer/ output directory.
//
// # Status
//
// This package is a placeholder for future Skill entity implementation.
// Skill definition support (FromLocal, FromGit) will be added in a future release.
//
// # Referencing Skills
//
// To reference existing skills from agents, use the skillref package:
//
//	import "github.com/stigmer/stigmer/sdk/go/skillref"
//
//	reviewer.AddSkillRef(skillref.New("stigmer", "coding-best-practices"))
//	reviewer.AddSkillRef(skillref.New("stigmer", "security-guidelines", skillref.WithVersion("v2.0")))
package skill
