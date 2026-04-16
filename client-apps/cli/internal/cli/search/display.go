// Package search provides CLI utilities for the unified Search API.
// This file contains display functions for rendering search results.
package search

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	searchv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/search/v1"
)

const (
	// DefaultDescriptionMaxLen is the default max length for descriptions in table view.
	DefaultDescriptionMaxLen = 50
)

// DisplayOptions controls how search results are rendered.
type DisplayOptions struct {
	// Format is the output format: "table" (default), "yaml", "json".
	Format string

	// ShowKind includes the KIND column (useful for discover mode).
	ShowKind bool

	// ShowOrg includes the ORG column.
	ShowOrg bool

	// MaxDescLen is the max length for descriptions in table view.
	// Default: 50.
	MaxDescLen int

	// ResourceName is used for messages (e.g., "agent", "skill").
	ResourceName string
}

// DisplayResults renders search results to stdout.
func DisplayResults(results *Result, opts *DisplayOptions) {
	if opts == nil {
		opts = &DisplayOptions{}
	}

	if opts.MaxDescLen <= 0 {
		opts.MaxDescLen = DefaultDescriptionMaxLen
	}

	display.DisplayProtoSlice(results.Entries, opts.Format, func() {
		displayResultsTable(results, opts)
	})
}

// DisplayEmptyResults shows a helpful message when no results found.
// Delegates to the shared display.DisplayEmptyResults utility.
func DisplayEmptyResults(resourceName string, query string) {
	display.DisplayEmptyResults(resourceName, query)
}

// DisplayPaginationInfo shows current page and total pages.
func DisplayPaginationInfo(page, totalPages, totalCount int32) {
	if totalPages <= 1 {
		return
	}

	dimColor := color.New(color.Faint)
	fmt.Println()
	dimColor.Printf("Page %d of %d (total: %d)\n", page, totalPages, totalCount)

	if page < totalPages {
		dimColor.Printf("Use --page %d to see more results\n", page+1)
	}
}

// displayResultsTable renders results in a formatted table.
func displayResultsTable(results *Result, opts *DisplayOptions) {
	if results.IsEmpty() {
		DisplayEmptyResults(opts.ResourceName, "")
		return
	}

	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()
	dimColor := color.New(color.Faint).SprintFunc()

	tbl := display.NewTable(
		buildTableHeaders(opts),
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, entry := range results.Entries {
		tbl.AddRow(buildTableRow(entry, opts, dimColor)...)
	}

	fmt.Println()
	tbl.Render(os.Stdout)
}

// buildTableHeaders builds table headers based on display options.
func buildTableHeaders(opts *DisplayOptions) []string {
	headers := []string{"NAME"}

	if opts.ShowKind {
		headers = append(headers, "KIND")
	}

	headers = append(headers, "DESCRIPTION")

	if opts.ShowOrg {
		headers = append(headers, "ORG")
	}

	headers = append(headers, "VISIBILITY", "CREATED")

	return headers
}

// buildTableRow builds a table row from a search result.
func buildTableRow(entry *searchv1.SearchResult, opts *DisplayOptions, dimColor func(...interface{}) string) []string {
	row := []string{entry.GetQualifiedSlug()}

	if opts.ShowKind {
		row = append(row, formatKind(entry.GetKind().String()))
	}

	desc := display.TruncateDescription(entry.GetDescription(), opts.MaxDescLen)
	desc = display.NormalizeWhitespace(desc)
	row = append(row, desc)

	if opts.ShowOrg {
		row = append(row, entry.GetOrg())
	}

	visibility := formatVisibility(entry.GetVisibility())
	row = append(row, visibility)

	created := formatRelativeTime(entry.GetCreatedAt().AsTime())
	row = append(row, dimColor(created))

	return row
}

// formatKind formats the resource kind for display.
func formatKind(kind string) string {
	// Convert "api_resource_kind_agent" to "Agent"
	kind = strings.TrimPrefix(kind, "api_resource_kind_")
	if len(kind) > 0 {
		return strings.ToUpper(kind[:1]) + kind[1:]
	}
	return kind
}

// formatVisibility formats the visibility enum for display.
func formatVisibility(v apiresource.ApiResourceVisibility) string {
	switch v {
	case apiresource.ApiResourceVisibility_visibility_public:
		return "public"
	case apiresource.ApiResourceVisibility_visibility_private:
		return "private"
	default:
		return "unknown"
	}
}

// formatRelativeTime formats a timestamp as relative time.
func formatRelativeTime(t time.Time) string {
	if t.IsZero() {
		return "-"
	}

	seconds := int64(time.Since(t).Seconds())
	return display.FormatRelativeTime(seconds)
}
