package mcpserver

import (
	"fmt"

	"buf.build/go/protovalidate"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/commons/metadata"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

// validator is the global protovalidate validator instance.
var validator protovalidate.Validator

func init() {
	// Initialize validator once at package load time
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// ToProto converts the SDK MCPServer to a platform McpServer proto message.
//
// This method creates a complete McpServer proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK MCPServer.Args to proto McpServerSpec
//
// The implementation reads from Args (single source of truth) following the
// composition pattern. Args fields are already proto stubs types, so they
// can be used directly without conversion.
//
// Example:
//
//	server, _ := mcpserver.Stdio(ctx, "github-mcp", &mcpserver.McpServerArgs{
//	    Description: "GitHub MCP server",
//	    Stdio: &mcpserverv1.StdioServerConfig{
//	        Command: "npx",
//	        Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	    },
//	})
//	proto, err := server.ToProto()
func (m *MCPServer) ToProto() (*mcpserverv1.McpServer, error) {
	if m.Args == nil {
		return nil, ErrArgsNil
	}

	// Build spec from Args - single source of truth
	// Args fields are already proto stubs types, use them directly
	spec := &mcpserverv1.McpServerSpec{
		Description:          m.Args.Description,
		IconUrl:              m.Args.IconUrl,
		Tags:                 m.Args.Tags,
		DefaultEnabledTools:  m.Args.DefaultEnabledTools,
		EnvSpec:              m.Args.EnvSpec,
		DefaultToolApprovals: m.Args.DefaultToolApprovals,
	}

	// Set server type from Args (oneof field)
	if m.Args.Stdio != nil {
		spec.ServerType = &mcpserverv1.McpServerSpec_Stdio{
			Stdio: m.Args.Stdio,
		}
	} else if m.Args.Http != nil {
		spec.ServerType = &mcpserverv1.McpServerSpec_Http{
			Http: m.Args.Http,
		}
	}

	// Auto-generate slug if empty
	slug := m.Slug
	if slug == "" {
		slug = naming.GenerateSlug(m.Name)
	}

	// Build metadata
	// Default to private visibility for SDK-created MCP servers
	meta := &apiresource.ApiResourceMetadata{
		Name:        m.Name,
		Slug:        slug,
		Org:         m.Org,
		Annotations: metadata.SDKAnnotations(),
		Visibility:  apiresource.ApiResourceVisibility_visibility_private,
	}

	// Build complete McpServer proto
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata:   meta,
		Spec:       spec,
	}

	// Validate the proto message against buf.validate rules
	if err := validator.Validate(mcpServer); err != nil {
		return nil, fmt.Errorf("mcpserver validation failed: %w", err)
	}

	return mcpServer, nil
}
