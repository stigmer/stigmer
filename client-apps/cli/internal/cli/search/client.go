// Package search provides CLI utilities for the unified Search API.
// This package is shared by all resource list/search commands (agent, skill,
// mcpserver, workflow) and the root discover command.
package search

import (
	"context"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/search/v1"
)

const (
	// DefaultTimeout is the default context timeout for search operations.
	DefaultTimeout = 10 * time.Second

	// DefaultPageSize is the default number of results per page.
	DefaultPageSize = 20

	// MaxPageSize is the maximum allowed page size.
	MaxPageSize = 100
)

// Options contains parameters for a search operation.
// All fields are optional except Client.
type Options struct {
	// Client is the Stigmer SDK client. Required.
	Client *stigmer.Client

	// Kinds specifies which resource types to search.
	// Empty means search all kinds (discover mode).
	Kinds []apiresourcekind.ApiResourceKind

	// Query is the text search query.
	// Empty means list mode (return all accessible resources).
	Query string

	// Org scopes the search to a specific organization.
	// Empty means search all organizations the caller has access to.
	Org string

	// ExcludePublic excludes public/platform resources from results.
	ExcludePublic bool

	// Page is the page number (1-indexed). Default: 1.
	Page int32

	// PageSize is the number of results per page. Default: 20, Max: 100.
	PageSize int32
}

// Result wraps the search response with convenience methods.
type Result struct {
	// Entries contains the search results for the current page.
	Entries []*searchv1.SearchResult

	// CountsByKind contains the total count per resource kind.
	CountsByKind map[string]int32

	// TotalCount is the total number of matching resources.
	TotalCount int32

	// TotalPages is the total number of pages.
	TotalPages int32
}

// IsEmpty returns true if no results were found.
func (r *Result) IsEmpty() bool {
	return len(r.Entries) == 0
}

// HasMorePages returns true if there are more pages after the current one.
func (r *Result) HasMorePages(currentPage int32) bool {
	return currentPage < r.TotalPages
}

// Search executes a search query via the SearchService.
// Returns the search results or an error with descriptive context.
func Search(opts *Options) (*Result, error) {
	if err := validateOptions(opts); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	params := buildSearchParams(opts)

	resp, err := opts.Client.Search.Query(ctx, params)
	if err != nil {
		return nil, errors.Wrap(err, "search request failed")
	}

	return &Result{
		Entries:    resp.Entries,
		TotalCount: resp.TotalCount,
		TotalPages: resp.TotalPages,
	}, nil
}

// validateOptions validates the search options.
func validateOptions(opts *Options) error {
	if opts.Client == nil {
		return errors.New("client is required")
	}

	if opts.PageSize > MaxPageSize {
		return errors.Errorf("page size cannot exceed %d", MaxPageSize)
	}

	return nil
}

// buildSearchParams constructs SearchParams from options.
func buildSearchParams(opts *Options) *stigmer.SearchParams {
	page := opts.Page
	if page <= 0 {
		page = 1
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}

	return &stigmer.SearchParams{
		Kinds:         opts.Kinds,
		Query:         opts.Query,
		Org:           opts.Org,
		ExcludePublic: opts.ExcludePublic,
		Page:          &stigmer.Page{Num: page, Size: pageSize},
	}
}

// ListOptions is a convenience type for list operations (no query).
type ListOptions struct {
	Client   *stigmer.Client
	Kind     apiresourcekind.ApiResourceKind
	Org      string
	Page     int32
	PageSize int32
}

// List is a convenience function for listing resources of a specific kind.
// This is equivalent to Search with a single kind and no query.
func List(opts *ListOptions) (*Result, error) {
	return Search(&Options{
		Client:   opts.Client,
		Kinds:    []apiresourcekind.ApiResourceKind{opts.Kind},
		Query:    "",
		Org:      opts.Org,
		Page:     opts.Page,
		PageSize: opts.PageSize,
	})
}
