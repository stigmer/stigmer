package mcpserver

import (
	"fmt"
	"time"

	"buf.build/go/protovalidate"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

const (
	// SDKLanguage is the programming language used for this MCP server definition
	SDKLanguage = "go"

	// SDKVersion is the version of the Go SDK
	// TODO: Read from version file or embed during build
	SDKVersion = "0.1.0"

	// Annotation keys for SDK metadata
	AnnotationSDKLanguage    = "stigmer.ai/sdk.language"
	AnnotationSDKVersion     = "stigmer.ai/sdk.version"
	AnnotationSDKGeneratedAt = "stigmer.ai/sdk.generated-at"
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

// SDKAnnotations returns a map of SDK metadata annotations to be added to resource metadata.
//
// These annotations track that the resource was created by the Go SDK and when.
// The CLI and platform use these annotations for telemetry and debugging.
//
// Returns:
//
//	map[string]string{
//	    "stigmer.ai/sdk.language":    "go",
//	    "stigmer.ai/sdk.version":     "0.1.0",
//	    "stigmer.ai/sdk.generated-at": "1706789123",  // Unix timestamp
//	}
func SDKAnnotations() map[string]string {
	return map[string]string{
		AnnotationSDKLanguage:    SDKLanguage,
		AnnotationSDKVersion:     SDKVersion,
		AnnotationSDKGeneratedAt: fmt.Sprintf("%d", time.Now().Unix()),
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
// composition pattern. This ensures no data duplication and makes the code
// easier to maintain.
//
// Example:
//
//	server, _ := mcpserver.Stdio(ctx, "github-mcp", &mcpserver.McpServerArgs{
//	    Description: "GitHub MCP server",
//	    Stdio: &types.StdioServerConfig{
//	        Command: "npx",
//	        Args:    []string{"-y", "@modelcontextprotocol/server-github"},
//	    },
//	})
//	proto, err := server.ToProto()
func (m *MCPServer) ToProto() (*mcpserverv1.McpServer, error) {
	if m.Args == nil {
		return nil, fmt.Errorf("mcpserver: Args is nil, cannot convert to proto")
	}

	// Build spec from Args - single source of truth
	spec := &mcpserverv1.McpServerSpec{
		Description:         m.Args.Description,
		IconUrl:             m.Args.IconUrl,
		Tags:                m.Args.Tags,
		DefaultEnabledTools: m.Args.DefaultEnabledTools,
	}

	// Convert server type from Args
	if m.Args.Stdio != nil {
		spec.ServerType = &mcpserverv1.McpServerSpec_Stdio{
			Stdio: convertStdioConfig(m.Args.Stdio),
		}
	} else if m.Args.Http != nil {
		spec.ServerType = &mcpserverv1.McpServerSpec_Http{
			Http: convertHttpConfig(m.Args.Http),
		}
	}
	// Note: Docker is in Args but not in the proto spec (only Stdio and Http are supported)

	// Convert environment spec if present
	if m.Args.EnvSpec != nil {
		spec.EnvSpec = convertEnvSpec(m.Args.EnvSpec)
	}

	// Auto-generate slug if empty
	slug := m.Slug
	if slug == "" {
		slug = naming.GenerateSlug(m.Name)
	}

	// Build metadata
	// Default to private visibility for SDK-created MCP servers
	metadata := &apiresource.ApiResourceMetadata{
		Name:        m.Name,
		Slug:        slug,
		Annotations: SDKAnnotations(),
		Visibility:  apiresource.ApiResourceVisibility_visibility_private,
	}

	// Build complete McpServer proto
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata:   metadata,
		Spec:       spec,
	}

	// Validate the proto message against buf.validate rules
	if err := validator.Validate(mcpServer); err != nil {
		return nil, fmt.Errorf("mcpserver validation failed: %w", err)
	}

	return mcpServer, nil
}

// convertStdioConfig converts SDK StdioServerConfig to proto StdioServerConfig.
func convertStdioConfig(sdk *types.StdioServerConfig) *mcpserverv1.StdioServerConfig {
	if sdk == nil {
		return nil
	}
	return &mcpserverv1.StdioServerConfig{
		Command:    sdk.Command,
		Args:       sdk.Args,
		WorkingDir: sdk.WorkingDir,
	}
}

// convertHttpConfig converts SDK HttpServerConfig to proto HttpServerConfig.
func convertHttpConfig(sdk *types.HttpServerConfig) *mcpserverv1.HttpServerConfig {
	if sdk == nil {
		return nil
	}
	return &mcpserverv1.HttpServerConfig{
		Url:            sdk.Url,
		Headers:        sdk.Headers,
		QueryParams:    sdk.QueryParams,
		TimeoutSeconds: sdk.TimeoutSeconds,
	}
}

// convertEnvSpec converts SDK EnvironmentSpec to proto EnvironmentSpec.
func convertEnvSpec(sdk *types.EnvironmentSpec) *environmentv1.EnvironmentSpec {
	if sdk == nil {
		return nil
	}

	// Convert environment data
	data := make(map[string]*environmentv1.EnvironmentValue)
	for k, v := range sdk.Data {
		if v != nil {
			data[k] = &environmentv1.EnvironmentValue{
				Value:       v.Value,
				IsSecret:    v.IsSecret,
				Description: v.Description,
			}
		}
	}

	return &environmentv1.EnvironmentSpec{
		Description: sdk.Description,
		Data:        data,
	}
}
