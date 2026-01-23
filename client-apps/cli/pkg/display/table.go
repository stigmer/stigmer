// Package display provides utilities for rendering formatted output in the CLI.
// It includes support for tabular displays of resources during apply operations.
package display

import (
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/olekukonko/tablewriter"
)

// ResourceType represents the type of resource being applied
type ResourceType string

const (
	ResourceTypeAgent    ResourceType = "Agent"
	ResourceTypeWorkflow ResourceType = "Workflow"
	ResourceTypeSkill    ResourceType = "Skill"
)

// ApplyStatus represents the status of an apply operation
type ApplyStatus string

const (
	ApplyStatusCreated ApplyStatus = "Created"
	ApplyStatusUpdated ApplyStatus = "Updated"
	ApplyStatusFailed  ApplyStatus = "Failed"
)

// AppliedResource represents a resource that was applied
type AppliedResource struct {
	Type   ResourceType
	Name   string
	Status ApplyStatus
	ID     string
	Error  error
}

// ApplyResultTable tracks resources applied and renders them as a table.
// It provides a professional, structured display of deployment results
// similar to Pulumi's resource table format.
type ApplyResultTable struct {
	Resources []AppliedResource
}

// NewApplyResultTable creates a new ApplyResultTable instance.
// Resources can be added using AddResource() before calling Render().
func NewApplyResultTable() *ApplyResultTable {
	return &ApplyResultTable{
		Resources: []AppliedResource{},
	}
}

// AddResource adds a resource to the table for display.
// Parameters:
//   - resourceType: The type of resource (Agent, Workflow, Skill)
//   - name: The name/slug of the resource
//   - status: The apply status (Created, Updated, Failed)
//   - id: The resource ID (can be empty for dry-run)
//   - err: Any error that occurred (for failed resources)
func (t *ApplyResultTable) AddResource(resourceType ResourceType, name string, status ApplyStatus, id string, err error) {
	t.Resources = append(t.Resources, AppliedResource{
		Type:   resourceType,
		Name:   name,
		Status: status,
		ID:     id,
		Error:  err,
	})
}

// Render renders the apply results table to stdout.
// Displays a formatted table with columns: TYPE, NAME, STATUS, ID
// Uses color coding: green for success, red for failures, dim for IDs.
// After the table, prints a summary of successful/failed resources.
func (t *ApplyResultTable) Render() {
	if len(t.Resources) == 0 {
		return
	}

	// Color definitions
	successColor := color.New(color.FgGreen).SprintFunc()
	errorColor := color.New(color.FgRed).SprintFunc()
	dimColor := color.New(color.Faint).SprintFunc()

	// Create table with minimal borders
	table := tablewriter.NewTable(os.Stdout)
	
	// Set header
	table.Header("TYPE", "NAME", "STATUS", "ID")

	for _, resource := range t.Resources {
		// Format status with color and emoji
		var statusStr string
		switch resource.Status {
		case ApplyStatusCreated:
			statusStr = successColor("✓ Created")
		case ApplyStatusUpdated:
			statusStr = successColor("✓ Updated")
		case ApplyStatusFailed:
			statusStr = errorColor("✗ Failed")
		default:
			statusStr = string(resource.Status)
		}

		// Truncate ID if too long
		idStr := resource.ID
		if len(idStr) > 25 {
			idStr = idStr[:22] + "..."
		}
		idStr = dimColor(idStr)

		table.Append(
			string(resource.Type),
			resource.Name,
			statusStr,
			idStr,
		)
	}

	fmt.Println()
	table.Render()
	fmt.Println()

	// Print summary
	t.printSummary()
}

// printSummary prints a summary of the apply operation
func (t *ApplyResultTable) printSummary() {
	successCount := 0
	failCount := 0

	for _, resource := range t.Resources {
		if resource.Status == ApplyStatusFailed {
			failCount++
		} else {
			successCount++
		}
	}

	successColor := color.New(color.FgGreen, color.Bold)
	errorColor := color.New(color.FgRed, color.Bold)

	if failCount == 0 {
		successColor.Printf("✅ Successfully applied %d resource(s)\n", successCount)
	} else {
		errorColor.Printf("⚠️  Applied %d resource(s) with %d failure(s)\n", successCount, failCount)
	}
	fmt.Println()
}

// RenderDryRun renders a dry-run preview table to stdout.
// Shows what resources would be applied without actually deploying them.
// Displays a simpler table with columns: TYPE, NAME, ACTION
// Does not include resource IDs since resources aren't actually created.
func (t *ApplyResultTable) RenderDryRun() {
	if len(t.Resources) == 0 {
		return
	}

	fmt.Println()
	infoColor := color.New(color.FgCyan, color.Bold)
	infoColor.Println("Dry run: The following resources would be applied:")
	fmt.Println()

	// Create table
	table := tablewriter.NewTable(os.Stdout)
	
	// Set header
	table.Header("TYPE", "NAME", "ACTION")

	for _, resource := range t.Resources {
		action := "Create"
		if resource.Status == ApplyStatusUpdated {
			action = "Update"
		}

		table.Append(
			string(resource.Type),
			resource.Name,
			action,
		)
	}

	table.Render()
	fmt.Println()

	successColor := color.New(color.FgGreen, color.Bold)
	successColor.Printf("💡 Dry run successful - no resources were deployed\n")
	fmt.Println()
}

// GetStatusIcon returns the status icon for a given apply status.
// Returns: ✓ for success, ✗ for failure, • for other states.
func GetStatusIcon(status ApplyStatus) string {
	switch status {
	case ApplyStatusCreated, ApplyStatusUpdated:
		return "✓"
	case ApplyStatusFailed:
		return "✗"
	default:
		return "•"
	}
}

// TruncateID truncates a resource ID to a reasonable display length.
// IDs longer than 25 characters are truncated to 22 chars plus "..."
func TruncateID(id string) string {
	if len(id) > 25 {
		return id[:22] + "..."
	}
	return id
}
