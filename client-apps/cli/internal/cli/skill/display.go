// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"fmt"

	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays a skill in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(skill *skillv1.Skill, format string) {
	display.DisplayProto(skill, format, func() { displaySkillTable(skill) })
}

// displaySkillTable displays the skill in human-readable table format.
func displaySkillTable(skill *skillv1.Skill) {
	fmt.Println()
	fmt.Printf("Skill: %s\n", skill.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", skill.Metadata.Id)
	fmt.Printf("  Name:        %s\n", skill.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", skill.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", skill.Metadata.Org)
	fmt.Println()

	if skill.Spec != nil {
		fmt.Printf("Spec:\n")
		if skill.Spec.Name != "" {
			fmt.Printf("  Name:        %s\n", skill.Spec.Name)
		}
		if skill.Spec.Tag != "" {
			fmt.Printf("  Tag:         %s\n", skill.Spec.Tag)
		}
		if skill.Spec.Description != "" {
			fmt.Printf("  Description: %s\n", display.TruncateWithEllipsis(skill.Spec.Description, 80))
		}
		fmt.Println()
	}

	if skill.Status != nil {
		fmt.Printf("Status:\n")
		if skill.Status.VersionHash != "" {
			fmt.Printf("  Version:     %s\n", display.TruncateWithEllipsis(skill.Status.VersionHash, 16))
		}
		if skill.Status.State != skillv1.SkillState_SKILL_STATE_UNSPECIFIED {
			fmt.Printf("  State:       %s\n", skill.Status.State.String())
		}
		if skill.Status.GitProvenance != nil {
			prov := skill.Status.GitProvenance
			if prov.RemoteUrl != "" {
				fmt.Printf("  Git Remote:  %s\n", prov.RemoteUrl)
			}
			if prov.Commit != "" {
				fmt.Printf("  Git Commit:  %s\n", display.TruncateWithEllipsis(prov.Commit, 12))
			}
		}
		fmt.Println()
	}
}
