// Package display provides utilities for rendering formatted output in the CLI.
// It includes support for tabular displays of resources during apply operations.
package display

import (
	"fmt"
	"strings"

	"github.com/fatih/color"
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
// Adapts to terminal width and only truncates IDs when necessary.
// After the table, prints a summary of successful/failed resources.
func (t *ApplyResultTable) Render() {
	if len(t.Resources) == 0 {
		return
	}

	// Color definitions
	successColor := color.New(color.FgGreen).SprintFunc()
	errorColor := color.New(color.FgRed).SprintFunc()
	dimColor := color.New(color.Faint).SprintFunc()
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()

	// Define column headers
	headers := []string{"TYPE", "NAME", "STATUS", "ID"}
	
	// Build rows data
	rows := make([][]string, len(t.Resources))
	for i, resource := range t.Resources {
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

		rows[i] = []string{
			string(resource.Type),
			resource.Name,
			statusStr,
			dimColor(resource.ID), // Don't truncate yet, let adaptive layout handle it
		}
	}

	// Render table with adaptive width
	fmt.Println()
	renderAdaptiveTable(headers, rows, headerColor)
	fmt.Println()

	// Print summary
	t.printSummary()
}

// renderAdaptiveTable renders a table that adapts to terminal width.
// It calculates optimal column widths and truncates only when necessary.
// Inspired by Pulumi's sophisticated table rendering.
func renderAdaptiveTable(headers []string, rows [][]string, headerColor func(...interface{}) string) {
	if len(rows) == 0 {
		return
	}

	// Get terminal width
	termWidth := GetTerminalWidth()
	
	// Calculate maximum width needed for each column
	maxWidths := make([]int, len(headers))
	
	// Measure headers
	for i, header := range headers {
		maxWidths[i] = MeasureColorizedString(header)
	}
	
	// Measure all rows
	for _, row := range rows {
		for i, cell := range row {
			if i < len(maxWidths) {
				cellWidth := MeasureColorizedString(cell)
				maxWidths[i] = max(maxWidths[i], cellWidth)
			}
		}
	}
	
	// Calculate total width needed (columns + padding)
	const columnGap = 3 // 3 spaces between columns
	totalNeeded := 0
	for _, w := range maxWidths {
		totalNeeded += w
	}
	totalNeeded += (len(maxWidths) - 1) * columnGap // gaps between columns
	
	// If table is too wide, intelligently shrink columns
	if totalNeeded > termWidth {
		// The ID column (last) is most truncatable
		// Calculate how much we need to shrink
		shrinkAmount := totalNeeded - termWidth
		
		// Try to shrink ID column first (it's usually the longest)
		idColIdx := len(maxWidths) - 1
		if maxWidths[idColIdx] > 30 { // Only shrink if ID is long enough
			shrinkID := min(shrinkAmount, maxWidths[idColIdx]-30)
			maxWidths[idColIdx] -= shrinkID
			shrinkAmount -= shrinkID
		}
		
		// If still too wide, shrink all columns proportionally
		if shrinkAmount > 0 {
			for i := range maxWidths {
				minWidth := 10 // Minimum useful width
				if maxWidths[i] > minWidth {
					shrink := min(shrinkAmount/(len(maxWidths)-i), maxWidths[i]-minWidth)
					maxWidths[i] -= shrink
					shrinkAmount -= shrink
				}
			}
		}
	}
	
	// Render header
	headerParts := make([]string, len(headers))
	for i, header := range headers {
		headerParts[i] = PadRight(headerColor(header), maxWidths[i])
	}
	fmt.Println(strings.Join(headerParts, strings.Repeat(" ", columnGap)))
	
	// Render separator line
	separatorParts := make([]string, len(headers))
	for i, width := range maxWidths {
		separatorParts[i] = strings.Repeat("─", width)
	}
	fmt.Println(strings.Join(separatorParts, strings.Repeat(" ", columnGap)))
	
	// Render rows
	for _, row := range rows {
		rowParts := make([]string, len(row))
		for i, cell := range row {
			if i < len(maxWidths) {
				// Trim cell to max width if needed (preserving colors)
				cellWidth := MeasureColorizedString(cell)
				if cellWidth > maxWidths[i] {
					cell = TrimColorizedString(cell, maxWidths[i]-3) + "..."
				}
				rowParts[i] = PadRight(cell, maxWidths[i])
			}
		}
		fmt.Println(strings.Join(rowParts, strings.Repeat(" ", columnGap)))
	}
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
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

	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()
	
	// Define headers for dry run (no ID column)
	headers := []string{"TYPE", "NAME", "ACTION"}
	
	// Build rows
	rows := make([][]string, len(t.Resources))
	for i, resource := range t.Resources {
		action := "Create"
		if resource.Status == ApplyStatusUpdated {
			action = "Update"
		}

		rows[i] = []string{
			string(resource.Type),
			resource.Name,
			action,
		}
	}

	// Render table
	renderAdaptiveTable(headers, rows, headerColor)
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
