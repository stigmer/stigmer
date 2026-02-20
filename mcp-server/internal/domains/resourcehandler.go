package domains

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// VersionedFetchFunc is the signature for domain Fetch functions that accept
// an additional version parameter (e.g. skills).
type VersionedFetchFunc func(ctx context.Context, serverAddr, org, slug, version string) (string, error)

// NewResourceHandler creates a standard MCP resource handler that parses
// org and slug from the request URI and delegates to fetchFn.
func NewResourceHandler(fetchFn FetchFunc, serverAddr, domainName string) mcp.ResourceHandler {
	return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		org, slug, err := ParseResourceURI(req.Params.URI)
		if err != nil {
			return nil, fmt.Errorf("%s resource: %w", domainName, err)
		}
		text, err := fetchFn(ctx, serverAddr, org, slug)
		if err != nil {
			return nil, err
		}
		return ResourceResult(req.Params.URI, text), nil
	}
}

// NewVersionedResourceHandler creates an MCP resource handler that parses
// org, slug, and version from the request URI and delegates to fetchFn.
func NewVersionedResourceHandler(fetchFn VersionedFetchFunc, serverAddr, domainName string) mcp.ResourceHandler {
	return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		org, slug, version, err := ParseVersionedResourceURI(req.Params.URI)
		if err != nil {
			return nil, fmt.Errorf("%s versioned resource: %w", domainName, err)
		}
		text, err := fetchFn(ctx, serverAddr, org, slug, version)
		if err != nil {
			return nil, err
		}
		return ResourceResult(req.Params.URI, text), nil
	}
}

// ResourceResult constructs a ReadResourceResult with a single JSON text
// content entry.
func ResourceResult(uri, text string) *mcp.ReadResourceResult {
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{
			URI:      uri,
			MIMEType: "application/json",
			Text:     text,
		}},
	}
}
