// Package search provides the "search" MCP tool backed by stigmer-server's
// SearchService.search RPC.
//
// This single tool covers listing, full-text search, and cross-kind discovery
// — eliminating the need for separate list_agents / list_skills / list_workflows
// tools. The caller controls behavior through the combination of parameters:
//
//   - List agents in org:   {kinds: ["agent"], org: "acme"}
//   - Search across all:    {query: "kubernetes"}
//   - Filtered search:      {kinds: ["agent","skill"], query: "security", org: "acme"}
//
// Results are returned as a JSON object matching the SearchResponse protobuf
// message, serialized via protojson for clean field names and well-known-type
// handling (e.g. google.protobuf.Timestamp → RFC 3339 strings). Each result
// entry is enriched with a resource_uri field that MCP clients can pass
// directly to resources/read, bridging the discovery-to-read workflow.
package search

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"

	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	rpcpb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
)

// SearchInput defines the parameters that an MCP client can pass to the
// "search" tool.  Field tags drive the JSON Schema that the MCP SDK
// auto-generates and sends to clients during tool discovery.
type SearchInput struct {
	// Kinds restricts results to specific resource types.
	// Valid values: "agent", "skill", "mcp_server", "workflow".
	// Empty means search across all searchable kinds (discover mode).
	Kinds []string `json:"kinds,omitempty" jsonschema:"description=Resource kinds to search. Valid: agent, skill, mcp_server, workflow. Empty searches all."`

	// Query is a free-text search string. Empty returns all accessible
	// resources (list mode).
	Query string `json:"query,omitempty" jsonschema:"description=Full-text search query. Empty lists all accessible resources."`

	// Org scopes results to a single organization. Empty searches across
	// all organizations the caller has access to.
	Org string `json:"org,omitempty" jsonschema:"description=Organization slug to scope the search. Empty searches all accessible orgs."`

	// ExcludePublic, when true, hides platform-provided public resources.
	ExcludePublic bool `json:"exclude_public,omitempty" jsonschema:"description=Exclude public/platform resources from results."`

	// PageSize controls how many results per page (default 20, max 100).
	PageSize int32 `json:"page_size,omitempty" jsonschema:"description=Results per page (default 20, max 100)."`

	// PageNum selects which page to return (1-indexed, default 1).
	PageNum int32 `json:"page_num,omitempty" jsonschema:"description=Page number (1-indexed, default 1)."`
}

// Tool returns the MCP tool definition for registration with the server.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name: "search",
		Description: "Search and list Stigmer resources (agents, skills, MCP servers, workflows). " +
			"Set 'kinds' to filter by resource type. Set 'query' for full-text search. " +
			"Set 'org' to scope to an organization. Omit 'query' to list all accessible resources.",
	}
}

// Handler implements the "search" tool.  The serverAddress is captured at
// registration time; the API key is read from the context at call time.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *SearchInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input *SearchInput) (*mcp.CallToolResult, any, error) {
		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("search: %w", err)
		}
		defer conn.Close()

		// Map user-supplied kind strings to the proto enum values.
		kinds, err := parseKinds(input.Kinds)
		if err != nil {
			return nil, nil, err
		}

		grpcReq := &searchv1.SearchRequest{
			Kinds:         kinds,
			Query:         input.Query,
			Org:           input.Org,
			ExcludePublic: input.ExcludePublic,
		}
		if input.PageSize > 0 || input.PageNum > 0 {
			grpcReq.Page = &rpcpb.PageInfo{
				Size: input.PageSize,
				Num:  input.PageNum,
			}
		}

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := searchv1.NewSearchServiceClient(conn)
		resp, err := client.Search(rpcCtx, grpcReq)
		if err != nil {
			desc := "search results"
			if input.Org != "" {
				desc = fmt.Sprintf("search results in org %q", input.Org)
			}
			return nil, nil, domains.RPCError(err, desc)
		}

		text, err := enrichSearchResponse(resp)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}

// enrichSearchResponse serializes the search response to JSON and injects a
// resource_uri field into each entry that has a registered MCP resource
// template. Entries whose kind has no template (e.g. mcp_server) are left
// without a resource_uri.
//
// When the response has no entries, it short-circuits to domains.MarshalJSON
// to avoid unnecessary round-tripping.
func enrichSearchResponse(resp *searchv1.SearchResponse) (string, error) {
	if len(resp.GetEntries()) == 0 {
		return domains.MarshalJSON(resp)
	}

	raw, err := domains.MarshalOptions.Marshal(resp)
	if err != nil {
		return "", fmt.Errorf("protojson marshal: %w", err)
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return "", fmt.Errorf("json unmarshal: %w", err)
	}

	entries, _ := data["entries"].([]any)
	for i, e := range entries {
		entry, ok := e.(map[string]any)
		if !ok {
			continue
		}
		if i >= len(resp.Entries) {
			break
		}
		r := resp.Entries[i]
		uri := domains.BuildResourceURI(r.Kind.String(), r.Org, r.Slug)
		if uri != "" {
			entry["resource_uri"] = uri
		}
	}

	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("json marshal: %w", err)
	}
	return string(out), nil
}

// knownKinds maps user-friendly kind names to proto enum values.
var knownKinds = map[string]apiresourcekind.ApiResourceKind{
	"agent":      apiresourcekind.ApiResourceKind_agent,
	"skill":      apiresourcekind.ApiResourceKind_skill,
	"mcp_server": apiresourcekind.ApiResourceKind_mcp_server,
	"workflow":   apiresourcekind.ApiResourceKind_workflow,
}

// parseKinds converts user-supplied kind strings to proto enum values.
func parseKinds(raw []string) ([]apiresourcekind.ApiResourceKind, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out := make([]apiresourcekind.ApiResourceKind, 0, len(raw))
	for _, s := range raw {
		k, ok := knownKinds[s]
		if !ok {
			return nil, fmt.Errorf("unknown resource kind %q; valid kinds: agent, skill, mcp_server, workflow", s)
		}
		out = append(out, k)
	}
	return out, nil
}
