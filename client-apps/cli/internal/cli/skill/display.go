// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"fmt"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
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
	cliprint.PrintInfo("Skill: %s", skill.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:          %s", skill.Metadata.Id)
	cliprint.PrintInfo("  Name:        %s", skill.Metadata.Name)
	cliprint.PrintInfo("  Slug:        %s", skill.Metadata.Slug)
	cliprint.PrintInfo("  Org:         %s", skill.Metadata.Org)
	fmt.Println()

	if skill.Spec != nil {
		cliprint.PrintInfo("Spec:")
		if skill.Spec.Name != "" {
			cliprint.PrintInfo("  Name:        %s", skill.Spec.Name)
		}
		if skill.Spec.Tag != "" {
			cliprint.PrintInfo("  Tag:         %s", skill.Spec.Tag)
		}
		if skill.Spec.Description != "" {
			cliprint.PrintInfo("  Description: %s", truncateString(skill.Spec.Description, 80))
		}
		fmt.Println()
	}

	if skill.Status != nil {
		cliprint.PrintInfo("Status:")
		if skill.Status.VersionHash != "" {
			cliprint.PrintInfo("  Version:     %s", truncateString(skill.Status.VersionHash, 16))
		}
		if skill.Status.State != skillv1.SkillState_SKILL_STATE_UNSPECIFIED {
			cliprint.PrintInfo("  State:       %s", skill.Status.State.String())
		}
		if skill.Status.GitProvenance != nil {
			prov := skill.Status.GitProvenance
			if prov.RemoteUrl != "" {
				cliprint.PrintInfo("  Git Remote:  %s", prov.RemoteUrl)
			}
			if prov.Commit != "" {
				cliprint.PrintInfo("  Git Commit:  %s", truncateString(prov.Commit, 12))
			}
		}
		fmt.Println()
	}
}

// truncateString truncates a string to maxLen characters, adding "..." if truncated.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}
