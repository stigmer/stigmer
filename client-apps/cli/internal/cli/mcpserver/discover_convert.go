package mcpserver

import (
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// convertTools maps MCP SDK Tool types to proto DiscoveredTool messages.
func convertTools(tools []*mcp.Tool) []*mcpserverv1.DiscoveredTool {
	result := make([]*mcpserverv1.DiscoveredTool, 0, len(tools))
	for _, t := range tools {
		dt := &mcpserverv1.DiscoveredTool{
			Name:        t.Name,
			Description: t.Description,
		}
		if schema, err := convertInputSchema(t.InputSchema); err != nil {
			log.Debug().Str("tool", t.Name).Err(err).Msg("skipping input schema conversion")
		} else {
			dt.InputSchema = schema
		}
		result = append(result, dt)
	}
	return result
}

// convertResourceTemplates maps MCP SDK ResourceTemplate types to proto DiscoveredResourceTemplate messages.
func convertResourceTemplates(templates []*mcp.ResourceTemplate) []*mcpserverv1.DiscoveredResourceTemplate {
	result := make([]*mcpserverv1.DiscoveredResourceTemplate, 0, len(templates))
	for _, t := range templates {
		result = append(result, &mcpserverv1.DiscoveredResourceTemplate{
			UriTemplate: t.URITemplate,
			Name:        t.Name,
			Description: t.Description,
			MimeType:    t.MIMEType,
		})
	}
	return result
}

// convertInputSchema converts an MCP tool's InputSchema (any) to a protobuf Struct.
//
// The MCP SDK deserializes JSON Schema from the server into a map[string]any.
// We need to convert that into a google.protobuf.Struct for storage.
// If the schema is nil, we return nil (valid -- some tools have no parameters).
func convertInputSchema(schema any) (*structpb.Struct, error) {
	if schema == nil {
		return nil, nil
	}

	switch v := schema.(type) {
	case map[string]any:
		return structpb.NewStruct(v)

	default:
		// The SDK may return other types if the server sends unexpected JSON.
		// Round-trip through JSON to normalize to map[string]any.
		raw, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal input schema: %w", err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("input schema is not a JSON object: %w", err)
		}
		return structpb.NewStruct(m)
	}
}
