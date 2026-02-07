// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"fmt"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayGetResult displays a skill in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(skill *skillv1.Skill, format string) {
	switch format {
	case "yaml":
		displaySkillYAML(skill)
	case "json":
		displaySkillJSON(skill)
	default: // table
		displaySkillTable(skill)
	}
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

// displaySkillYAML displays the skill as YAML.
func displaySkillYAML(skill *skillv1.Skill) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(skill)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal skill to JSON: %w", err))
		return
	}

	// Convert JSON to YAML via generic map
	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

// displaySkillJSON displays the skill as JSON.
func displaySkillJSON(skill *skillv1.Skill) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(skill)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal skill to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
}

// DisplayDeleteConfirmation displays the skill details before deletion.
// Used to show the user what will be deleted for confirmation.
func DisplayDeleteConfirmation(skill *skillv1.Skill) {
	fmt.Println()
	cliprint.PrintWarning("You are about to delete the following skill:")
	fmt.Println()
	cliprint.PrintInfo("  ID:   %s", skill.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", skill.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", skill.Metadata.Slug)
	cliprint.PrintInfo("  Org:  %s", skill.Metadata.Org)
	if skill.Spec != nil && skill.Spec.Tag != "" {
		cliprint.PrintInfo("  Tag:  %s", skill.Spec.Tag)
	}
	fmt.Println()
	cliprint.PrintWarning("This will delete the skill and all its versions.")
	cliprint.PrintWarning("This action cannot be undone.")
	fmt.Println()
}

// DisplayDeleteResult displays the result of a delete operation.
// Shows success message confirming the skill was deleted.
func DisplayDeleteResult(result *DeleteResult) {
	fmt.Println()
	cliprint.PrintSuccess("Skill deleted successfully")
	fmt.Println()

	cliprint.PrintInfo("Deleted Resource:")
	cliprint.PrintInfo("  ID:   %s", result.Skill.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.Skill.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.Skill.Metadata.Slug)
	fmt.Println()
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
