// Package controller provides the gRPC service implementation for SearchService.
//
// This controller is the thin adapter layer between gRPC and the SearchHandler.
// It implements the generated SearchServiceServer interface and delegates all
// business logic to the handler.
//
// # Architecture
//
// The controller follows the pattern established in domain controllers:
//   - Implements the generated gRPC server interface
//   - Embeds the UnimplementedServer for forward compatibility
//   - Delegates to handler for business logic
//   - Converts handler errors to appropriate gRPC status codes
//
// # Error Handling
//
// Errors from the handler are converted to gRPC status codes:
//   - Validation errors -> InvalidArgument
//   - Not found -> NotFound
//   - Internal errors -> Internal
package controller

import (
	"context"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/handler"
)

// SearchController implements the SearchServiceServer gRPC interface.
//
// It serves as the thin adapter layer between gRPC and the SearchHandler,
// handling error conversion and logging.
type SearchController struct {
	searchv1.UnimplementedSearchServiceServer
	handler *handler.SearchHandler
}

// NewSearchController creates a new SearchController with the provided handler.
func NewSearchController(handler *handler.SearchHandler) *SearchController {
	return &SearchController{
		handler: handler,
	}
}

// Search implements the SearchService.Search RPC.
//
// This is the unified entry point for list, search, and discover operations.
// The behavior is determined by the combination of request parameters:
//
//	| Operation | kinds   | query | org     | Behavior                              |
//	|-----------|---------|-------|---------|---------------------------------------|
//	| List      | [X]     | ""    | "acme"  | All X in org, sorted by created_at    |
//	| List All  | [X]     | ""    | ""      | All accessible X, sorted by created_at|
//	| Search    | [X]     | "..."  | ""      | Search X by query, sorted by relevance|
//	| Search Org| [X]     | "..."  | "acme"  | Search X in org, sorted by relevance  |
//	| Discover  | []      | "..."  | ""      | Search all kinds, sorted by relevance |
func (c *SearchController) Search(ctx context.Context, req *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	log.Debug().
		Strs("kinds", kindsToStrings(req.Kinds)).
		Str("query", req.Query).
		Str("org", req.Org).
		Bool("exclude_public", req.ExcludePublic).
		Msg("SearchService.Search called")

	resp, err := c.handler.Handle(ctx, req)
	if err != nil {
		log.Error().Err(err).Msg("Search failed")
		return nil, toGRPCError(err)
	}

	return resp, nil
}

// kindsToStrings converts a slice of ApiResourceKind to strings for logging.
func kindsToStrings(kinds []apiresourcekind.ApiResourceKind) []string {
	result := make([]string, len(kinds))
	for i, k := range kinds {
		result[i] = k.String()
	}
	return result
}

// toGRPCError converts a handler error to an appropriate gRPC status error.
func toGRPCError(err error) error {
	// Check for specific error types and map to gRPC codes
	errStr := err.Error()

	// Validation errors
	if contains(errStr, "validation failed", "invalid", "exceeds maximum") {
		return status.Error(codes.InvalidArgument, err.Error())
	}

	// Default to internal error. The handler error's raw text is server
	// internals and must stay off the wire (stigmer/stigmer#478); the call
	// site has already logged the full error.
	return grpclib.InternalError(err, "search failed")
}

// contains checks if s contains any of the substrings.
func contains(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if len(s) >= len(sub) {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}
