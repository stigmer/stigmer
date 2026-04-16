// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// displayWorkflowSummary displays a summary of Workflow configuration fields.
// Internal helper for consistent formatting across display functions.
func displayWorkflowSummary(workflow *workflowv1.Workflow) {
	fmt.Printf("  Name:         %s\n", workflow.Metadata.Name)

	if workflow.Spec != nil {
		if workflow.Spec.Description != "" {
			fmt.Printf("  Description:  %s\n", display.TruncateWithEllipsis(workflow.Spec.Description, 80))
		}

		taskCount := len(workflow.Spec.Tasks)
		if taskCount > 0 {
			fmt.Printf("  Tasks:        %d\n", taskCount)
		}

		if workflow.Spec.Document != nil {
			if workflow.Spec.Document.Version != "" {
				fmt.Printf("  Version:      %s\n", workflow.Spec.Document.Version)
			}
		}
	}
}

// DisplayGetResult displays a workflow in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(workflow *workflowv1.Workflow, format string) {
	display.DisplayProto(workflow, format, func() { displayWorkflowTable(workflow) })
}

// displayWorkflowTable displays the workflow in human-readable table format.
func displayWorkflowTable(workflow *workflowv1.Workflow) {
	fmt.Println()
	fmt.Printf("Workflow: %s\n", workflow.Metadata.Name)
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:          %s\n", workflow.Metadata.Id)
	fmt.Printf("  Name:        %s\n", workflow.Metadata.Name)
	fmt.Printf("  Slug:        %s\n", workflow.Metadata.Slug)
	fmt.Printf("  Org:         %s\n", workflow.Metadata.Org)
	fmt.Println()

	fmt.Printf("Spec:\n")
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
		fmt.Printf("Found %d workflows matching '%s'\n", results.TotalCount, query)
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
