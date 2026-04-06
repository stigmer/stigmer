// Package handler provides the search request handler with pipeline-based processing.
//
// The handler orchestrates the search flow through composable pipeline steps:
//  1. ValidateRequest - Validates proto field constraints
//  2. BuildSearchCriteria - Converts request to validated value object
//  3. ExecuteSearch - Queries the search store
//  4. BuildResponse - Constructs the gRPC response
//
// # Design
//
// The handler follows the established pipeline pattern in the codebase,
// providing clear separation of concerns and testability. Unlike domain
// handlers that work with aggregates, this is a CQRS query handler that
// returns read-optimized projections.
//
// # OSS vs Cloud
//
// The OSS version (this implementation) does not include an authorization
// step since it's single-user local mode. The cloud version adds a
// QueryAuthorizedIds step that queries OpenFGA for permitted resources.
package handler

import (
	"context"
	"fmt"

	"buf.build/go/protovalidate"
	"github.com/rs/zerolog/log"

	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/valueobject"
)

// SearchHandler processes search requests using a pipeline of steps.
//
// Pipeline steps (in order):
//  1. Validate request proto constraints
//  2. Build SearchCriteria value object
//  3. Execute search via SearchQueryStore
//  4. Build SearchResponse proto
type SearchHandler struct {
	store     store.SearchQueryStore
	validator protovalidate.Validator
}

// NewSearchHandler creates a new SearchHandler with the provided dependencies.
func NewSearchHandler(store store.SearchQueryStore) (*SearchHandler, error) {
	validator, err := protovalidate.New()
	if err != nil {
		return nil, fmt.Errorf("create validator: %w", err)
	}

	return &SearchHandler{
		store:     store,
		validator: validator,
	}, nil
}

// Handle processes a search request and returns a search response.
//
// This is the main entry point for search operations. It executes the
// following pipeline steps:
//
//  1. ValidateRequest - Validates proto field constraints using buf.validate
//  2. BuildSearchCriteria - Converts the request to a validated SearchCriteria
//  3. ExecuteSearch - Queries the FTS5 index via SearchQueryStore
//  4. BuildResponse - Constructs the SearchResponse proto from results
//
// Returns an error if any step fails. Errors are wrapped with context
// for debugging.
func (h *SearchHandler) Handle(ctx context.Context, req *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	// Step 1: Validate request
	if err := h.validateRequest(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Step 2: Build SearchCriteria
	criteria, err := h.buildSearchCriteria(req)
	if err != nil {
		return nil, fmt.Errorf("build criteria failed: %w", err)
	}

	// Step 3: Execute search
	result, err := h.executeSearch(ctx, criteria)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	// Step 4: Build response
	response := h.buildResponse(result)

	log.Debug().
		Int("results", len(response.Entries)).
		Int32("total", response.TotalCount).
		Bool("has_query", criteria.HasQuery()).
		Msg("Search completed")

	return response, nil
}

// validateRequest validates the proto field constraints.
func (h *SearchHandler) validateRequest(req *searchv1.SearchRequest) error {
	if err := h.validator.Validate(req); err != nil {
		return err
	}
	return nil
}

// buildSearchCriteria converts the request to a validated SearchCriteria.
func (h *SearchHandler) buildSearchCriteria(req *searchv1.SearchRequest) (*valueobject.SearchCriteria, error) {
	// Extract pagination parameters
	var pageNumber, pageSize int32
	if req.Page != nil {
		pageNumber = req.Page.Num
		pageSize = req.Page.Size
	}

	// Create the criteria with validation and normalization
	criteria, err := valueobject.NewSearchCriteria(
		req.Kinds,
		req.Query,
		req.Org,
		req.ExcludePublic,
		req.CrossOrgPublic,
		pageNumber,
		pageSize,
	)
	if err != nil {
		return nil, err
	}

	return criteria, nil
}

// executeSearch queries the search store.
func (h *SearchHandler) executeSearch(ctx context.Context, criteria *valueobject.SearchCriteria) (*valueobject.SearchPagedResult, error) {
	return h.store.Search(ctx, criteria)
}

// buildResponse constructs the SearchResponse proto from the result.
func (h *SearchHandler) buildResponse(result *valueobject.SearchPagedResult) *searchv1.SearchResponse {
	return &searchv1.SearchResponse{
		Entries:      result.Results(),
		CountsByKind: result.CountsByKind(),
		TotalCount:   result.TotalCount(),
		TotalPages:   result.TotalPages(),
	}
}
