// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// displayWorkflowSummary displays a summary of Workflow configuration fields.
// Internal helper for consistent formatting across display functions.
func displayWorkflowSummary(workflow *workflowv1.Workflow) {
	cliprint.PrintInfo("  Name:         %s", workflow.Metadata.Name)

	if workflow.Spec != nil {
		if workflow.Spec.Description != "" {
			cliprint.PrintInfo("  Description:  %s", truncateString(workflow.Spec.Description, 80))
		}

		taskCount := len(workflow.Spec.Tasks)
		if taskCount > 0 {
			cliprint.PrintInfo("  Tasks:        %d", taskCount)
		}

		if workflow.Spec.Document != nil {
			if workflow.Spec.Document.Version != "" {
				cliprint.PrintInfo("  Version:      %s", workflow.Spec.Document.Version)
			}
		}
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

// DisplayGetResult displays a workflow in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(workflow *workflowv1.Workflow, format string) {
	display.DisplayProto(workflow, format, func() { displayWorkflowTable(workflow) })
}

// displayWorkflowTable displays the workflow in human-readable table format.
func displayWorkflowTable(workflow *workflowv1.Workflow) {
	fmt.Println()
	cliprint.PrintInfo("Workflow: %s", workflow.Metadata.Name)
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:          %s", workflow.Metadata.Id)
	cliprint.PrintInfo("  Name:        %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Slug:        %s", workflow.Metadata.Slug)
	cliprint.PrintInfo("  Org:         %s", workflow.Metadata.Org)
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	displayWorkflowSummary(workflow)
	fmt.Println()
}

// DisplayListResult displays a list of workflows from search results.
// Uses the generic search display with workflow-specific settings.
func DisplayListResult(results *search.Result, format string, page int32) {
	if results.IsEmpty() {
		search.DisplayEmptyResults("workflows", "")
		return
	}

	search.DisplayResults(results, &search.DisplayOptions{
		Format:       format,
		ShowKind:     false, // Workflow-specific: don't show KIND column
		ShowOrg:      true,  // Show ORG since workflows can be from different orgs
		MaxDescLen:   50,
		ResourceName: "workflows",
	})

	search.DisplayPaginationInfo(page, results.TotalPages, results.TotalCount)
}

// DisplaySearchResult displays workflow search results with query context.
// Shows results sorted by relevance with the search query highlighted.
func DisplaySearchResult(results *search.Result, query string, format string, page int32) {
	if results.IsEmpty() {
		search.DisplayEmptyResults("workflows", query)
		return
	}

	// For search results, show a header indicating what was searched
	if format == "table" || format == "" {
		fmt.Println()
		cliprint.PrintInfo("Found %d workflows matching '%s'", results.TotalCount, query)
	}

	search.DisplayResults(results, &search.DisplayOptions{
		Format:       format,
		ShowKind:     false,
		ShowOrg:      true,
		MaxDescLen:   50,
		ResourceName: "workflows",
	})

	search.DisplayPaginationInfo(page, results.TotalPages, results.TotalCount)
}
