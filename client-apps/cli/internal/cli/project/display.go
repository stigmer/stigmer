// Package project provides CLI utilities for managing Project resources.
package project

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// DisplayProjectInfo displays a project in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayProjectInfo(project *projectv1.Project, format string) {
	display.DisplayProto(project, format, func() { displayProjectTable(project) })
}

// displayProjectTable displays the project in human-readable table format.
func displayProjectTable(project *projectv1.Project) {
	fmt.Println()
	fmt.Printf("Project: %s\n", project.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  Name:        %s\n", project.Metadata.Name)
	if project.Metadata.Org != "" {
		fmt.Printf("  Org:         %s\n", project.Metadata.Org)
	}
	fmt.Println()

	fmt.Printf("Spec:\n")
	displayProjectSummary(project)

	displayMemberCounts(project)
	fmt.Println()
}

func displayProjectSummary(project *projectv1.Project) {
	if project.Spec == nil {
		return
	}

	if project.Spec.EntryPoint != "" {
		fmt.Printf("  Entry Point: %s\n", project.Spec.EntryPoint)
		fmt.Printf("  Mode:        SDK\n")
	} else {
		fmt.Printf("  Mode:        declarative\n")
	}

	if project.Spec.Description != "" {
		fmt.Printf("  Description: %s\n", display.TruncateWithEllipsis(project.Spec.Description, 60))
	}
}

// displayMemberCounts displays the member counts grouped by resource kind.
func displayMemberCounts(project *projectv1.Project) {
	if project.Spec == nil {
		return
	}

	counts := make(map[apiresourcekind.ApiResourceKind]int)
	for _, m := range project.Spec.Members {
		counts[m.Kind]++
	}

	if len(counts) == 0 {
		return
	}

	var parts []string
	kindOrder := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
		apiresourcekind.ApiResourceKind_skill,
	}
	for _, kind := range kindOrder {
		if c, ok := counts[kind]; ok {
			parts = append(parts, fmt.Sprintf("%d %s(s)", c, kind.String()))
		}
	}

	if len(parts) > 0 {
		fmt.Println()
		fmt.Printf("Members:\n")
		fmt.Printf("  %s\n", strings.Join(parts, ", "))
	}
}

// DisplayProjectPreview displays a preview of the Project configuration.
// Used for dry-run mode to show what would be applied.
func DisplayProjectPreview(project *projectv1.Project) {
	fmt.Println()
	fmt.Printf("Project Preview:\n")
	displayProjectSummary(project)
	fmt.Println()
}

// DisplayValidationSuccess displays a success message after validation.
// Used for CI-friendly output from the validate command.
func DisplayValidationSuccess(project *projectv1.Project, sourcePath string) {
	fmt.Println()
	fmt.Printf("Project configuration is valid\n")
	fmt.Println()
	fmt.Printf("  File:    %s\n", sourcePath)
	fmt.Printf("  Name:    %s\n", project.Metadata.Name)
	if project.Spec != nil && project.Spec.EntryPoint != "" {
		fmt.Printf("  Mode:    SDK (entry_point: %s)\n", project.Spec.EntryPoint)
	} else {
		fmt.Printf("  Mode:    declarative\n")
	}
	fmt.Println()
}

// DisplayGetResult displays a project in the specified format.
// This is the entry point for the 'stigmer project get' command output.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(project *projectv1.Project, format string) {
	display.DisplayProto(project, format, func() { displayProjectGetTable(project) })
}

// displayProjectGetTable displays the project in detailed table format for get command.
func displayProjectGetTable(project *projectv1.Project) {
	fmt.Println()
	fmt.Printf("Project: %s\n", project.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:   %s\n", project.Metadata.Id)
	fmt.Printf("  Name: %s\n", project.Metadata.Name)
	fmt.Printf("  Slug: %s\n", project.Metadata.Slug)
	fmt.Printf("  Org:  %s\n", project.Metadata.Org)
	fmt.Println()

	fmt.Printf("Spec:\n")
	displayProjectSummary(project)

	displayMemberCounts(project)
	fmt.Println()
}
