// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayWorkflowPreview displays a preview of the Workflow configuration.
// Used for dry-run mode to show what would be applied.
func DisplayWorkflowPreview(workflow *workflowv1.Workflow) {
	fmt.Println()
	cliprint.PrintInfo("Workflow Preview:")
	displayWorkflowSummary(workflow)
	fmt.Println()
}

// DisplayApplyResult displays the result of an apply operation.
// Shows success message with resource details and next steps.
func DisplayApplyResult(result *ApplyResult) {
	fmt.Println()
	if result.Created {
		cliprint.PrintSuccess("Workflow created successfully")
	} else {
		cliprint.PrintSuccess("Workflow updated successfully")
	}

	fmt.Println()
	cliprint.PrintInfo("Resource Details:")
	cliprint.PrintInfo("  ID:   %s", result.Workflow.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.Workflow.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.Workflow.Metadata.Slug)

	fmt.Println()
	cliprint.PrintInfo("Next steps:")
	cliprint.PrintInfo("  - View details:  stigmer workflow get %s", result.Workflow.Metadata.Slug)
	cliprint.PrintInfo("  - Run workflow:  stigmer workflow run %s", result.Workflow.Metadata.Slug)
	cliprint.PrintInfo("  - Delete:        stigmer workflow delete %s", result.Workflow.Metadata.Slug)
	fmt.Println()
}

// DisplayDeleteResult displays the result of a delete operation.
// Shows success message confirming the workflow was deleted.
func DisplayDeleteResult(result *DeleteResult) {
	fmt.Println()
	cliprint.PrintSuccess("Workflow deleted successfully")
	fmt.Println()

	cliprint.PrintInfo("Deleted Resource:")
	cliprint.PrintInfo("  ID:   %s", result.Workflow.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.Workflow.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.Workflow.Metadata.Slug)
	fmt.Println()
}

// DisplayDeleteConfirmation displays the workflow details before deletion.
// Used to show the user what will be deleted for confirmation.
func DisplayDeleteConfirmation(workflow *workflowv1.Workflow) {
	fmt.Println()
	cliprint.PrintWarning("You are about to delete the following workflow:")
	fmt.Println()
	cliprint.PrintInfo("  ID:   %s", workflow.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", workflow.Metadata.Slug)
	cliprint.PrintInfo("  Org:  %s", workflow.Metadata.Org)
	fmt.Println()
	cliprint.PrintWarning("This action cannot be undone.")
	fmt.Println()
}

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
	switch format {
	case "yaml":
		displayWorkflowYAML(workflow)
	case "json":
		displayWorkflowJSON(workflow)
	default: // table
		displayWorkflowTable(workflow)
	}
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

// displayWorkflowYAML displays the workflow as YAML.
func displayWorkflowYAML(workflow *workflowv1.Workflow) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(workflow)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal workflow to JSON: %w", err))
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

// displayWorkflowJSON displays the workflow as JSON.
func displayWorkflowJSON(workflow *workflowv1.Workflow) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(workflow)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal workflow to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
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
