// Package search provides CLI utilities for the unified Search API.
// This package is shared by all resource list/search commands (agent, skill,
// mcpserver, workflow) and the root discover command.
package search

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/rpc"
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
// All fields are optional except Conn.
type Options struct {
	// Conn is the gRPC connection to use. Required.
	Conn grpc.ClientConnInterface

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

	client := searchv1.NewSearchServiceClient(opts.Conn)

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	req := buildRequest(opts)

	resp, err := client.Search(ctx, req)
	if err != nil {
		return nil, errors.Wrap(err, "search request failed")
	}

	return &Result{
		Entries:      resp.GetEntries(),
		CountsByKind: resp.GetCountsByKind(),
		TotalCount:   resp.GetTotalCount(),
		TotalPages:   resp.GetTotalPages(),
	}, nil
}

// validateOptions validates the search options.
func validateOptions(opts *Options) error {
	if opts.Conn == nil {
		return errors.New("connection is required")
	}

	if opts.PageSize > MaxPageSize {
		return errors.Errorf("page size cannot exceed %d", MaxPageSize)
	}

	return nil
}

// buildRequest constructs the SearchRequest proto from options.
func buildRequest(opts *Options) *searchv1.SearchRequest {
	req := &searchv1.SearchRequest{
		Kinds:         opts.Kinds,
		Query:         opts.Query,
		Org:           opts.Org,
		ExcludePublic: opts.ExcludePublic,
	}

	// Set pagination with defaults
	page := opts.Page
	if page <= 0 {
		page = 1
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}

	req.Page = &rpc.PageInfo{
		Num:  page,
		Size: pageSize,
	}

	return req
}

// ListOptions is a convenience type for list operations (no query).
type ListOptions struct {
	Conn     grpc.ClientConnInterface
	Kind     apiresourcekind.ApiResourceKind
	Org      string
	Page     int32
	PageSize int32
}

// List is a convenience function for listing resources of a specific kind.
// This is equivalent to Search with a single kind and no query.
func List(opts *ListOptions) (*Result, error) {
	return Search(&Options{
		Conn:     opts.Conn,
		Kinds:    []apiresourcekind.ApiResourceKind{opts.Kind},
		Query:    "",
		Org:      opts.Org,
		Page:     opts.Page,
		PageSize: opts.PageSize,
	})
}
