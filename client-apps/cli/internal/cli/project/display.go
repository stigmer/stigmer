// Package project provides CLI utilities for managing Project resources.
package project

import (
	"fmt"
	"strings"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayProjectInfo displays a project in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayProjectInfo(project *projectv1.Project, format string) {
	display.DisplayProto(project, format, func() { displayProjectTable(project) })
}

// displayProjectTable displays the project in human-readable table format.
func displayProjectTable(project *projectv1.Project) {
	fmt.Println()
	cliprint.PrintInfo("Project: %s", project.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  Name:        %s", project.Metadata.Name)
	if project.Metadata.Org != "" {
		cliprint.PrintInfo("  Org:         %s", project.Metadata.Org)
	}
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	displayProjectSummary(project)

	// Display resource counts derived from spec
	displayResourceCounts(project)
	fmt.Println()
}

// displayProjectSummary displays a summary of Project configuration fields.
// Internal helper for consistent formatting across display functions.
func displayProjectSummary(project *projectv1.Project) {
	if project.Spec == nil {
		return
	}

	runtime := runtimeToString(project.Spec.Runtime)
	cliprint.PrintInfo("  Runtime:     %s", runtime)

	entryPoint := project.Spec.EntryPoint
	if entryPoint == "" {
		entryPoint = getDefaultEntryPoint(project.Spec.Runtime)
		cliprint.PrintInfo("  Entry Point: %s (default)", entryPoint)
	} else {
		cliprint.PrintInfo("  Entry Point: %s", entryPoint)
	}

	if project.Spec.Description != "" {
		cliprint.PrintInfo("  Description: %s", truncateString(project.Spec.Description, 60))
	}
}

// displayResourceCounts displays the resource counts derived from spec.
// Counts are computed from the spec fields, not stored separately.
func displayResourceCounts(project *projectv1.Project) {
	if project.Spec == nil {
		return
	}

	var parts []string
	if len(project.Spec.Agents) > 0 {
		parts = append(parts, fmt.Sprintf("%d agents", len(project.Spec.Agents)))
	}
	if len(project.Spec.Workflows) > 0 {
		parts = append(parts, fmt.Sprintf("%d workflows", len(project.Spec.Workflows)))
	}
	if len(project.Spec.Skills) > 0 {
		parts = append(parts, fmt.Sprintf("%d skills", len(project.Spec.Skills)))
	}
	if len(project.Spec.McpServers) > 0 {
		parts = append(parts, fmt.Sprintf("%d mcp servers", len(project.Spec.McpServers)))
	}

	if len(parts) > 0 {
		fmt.Println()
		cliprint.PrintInfo("Resources:")
		cliprint.PrintInfo("  %s", strings.Join(parts, ", "))
	}
}

// DisplayProjectPreview displays a preview of the Project configuration.
// Used for dry-run mode to show what would be applied.
func DisplayProjectPreview(project *projectv1.Project) {
	fmt.Println()
	cliprint.PrintInfo("Project Preview:")
	displayProjectSummary(project)
	fmt.Println()
}

// DisplayValidationSuccess displays a success message after validation.
// Used for CI-friendly output from the validate command.
func DisplayValidationSuccess(project *projectv1.Project, sourcePath string) {
	fmt.Println()
	cliprint.PrintSuccess("Project configuration is valid")
	fmt.Println()
	cliprint.PrintInfo("  File:    %s", sourcePath)
	cliprint.PrintInfo("  Name:    %s", project.Metadata.Name)
	cliprint.PrintInfo("  Runtime: %s", runtimeToString(project.Spec.Runtime))
	fmt.Println()
}

// runtimeToString converts a ProjectRuntime enum to a lowercase display string.
func runtimeToString(runtime projectv1.ProjectRuntime) string {
	switch runtime {
	case projectv1.ProjectRuntime_go:
		return "go"
	case projectv1.ProjectRuntime_python:
		return "python"
	case projectv1.ProjectRuntime_node:
		return "node"
	default:
		return "unknown"
	}
}

// getDefaultEntryPoint returns the default entry point for a given runtime.
func getDefaultEntryPoint(runtime projectv1.ProjectRuntime) string {
	switch runtime {
	case projectv1.ProjectRuntime_go:
		return "main.go"
	case projectv1.ProjectRuntime_python:
		return "main.py"
	case projectv1.ProjectRuntime_node:
		return "index.ts"
	default:
		return ""
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

// DisplayGetResult displays a project in the specified format.
// This is the entry point for the 'stigmer project get' command output.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(project *projectv1.Project, format string) {
	display.DisplayProto(project, format, func() { displayProjectGetTable(project) })
}

// displayProjectGetTable displays the project in detailed table format for get command.
// This differs from displayProjectTable by showing more backend-specific fields.
func displayProjectGetTable(project *projectv1.Project) {
	fmt.Println()
	cliprint.PrintInfo("Project: %s", project.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:   %s", project.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", project.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", project.Metadata.Slug)
	cliprint.PrintInfo("  Org:  %s", project.Metadata.Org)
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	displayProjectSummary(project)

	// Display resource counts derived from spec
	displayResourceCounts(project)
	fmt.Println()
}

