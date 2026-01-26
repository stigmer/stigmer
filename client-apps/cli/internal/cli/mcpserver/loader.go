// Package mcpserver provides CLI utilities for managing MCP server resources.
// It handles YAML/JSON parsing and apply operations for McpServer configurations.
package mcpserver

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

const (
	// DefaultFileName is the default name for MCP server configuration files
	DefaultFileName = "mcpserver.yaml"
	// AlternateFileName is an alternate name for MCP server configuration files
	AlternateFileName = "MCPSERVER.yaml"
)

// LoadOptions contains options for loading an MCP server configuration
type LoadOptions struct {
	// FilePath is the path to the YAML/JSON file (optional, auto-detects if empty)
	FilePath string
}

// LoadResult contains the result of loading an MCP server configuration
type LoadResult struct {
	// McpServer is the parsed MCP server proto message
	McpServer *mcpserverv1.McpServer
	// SourcePath is the path to the file that was loaded
	SourcePath string
}

// Load loads an MCP server configuration from a YAML or JSON file.
// If opts.FilePath is empty, it searches for mcpserver.yaml or MCPSERVER.yaml
// in the current directory.
func Load(opts *LoadOptions) (*LoadResult, error) {
	filePath, err := resolveFilePath(opts.FilePath)
	if err != nil {
		return nil, err
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read file %s", filePath)
	}

	mcpServer, err := parseContent(content, filePath)
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		McpServer:  mcpServer,
		SourcePath: filePath,
	}, nil
}

// resolveFilePath resolves the file path to load from.
// If explicit path is provided, uses that. Otherwise, searches for default files.
func resolveFilePath(explicitPath string) (string, error) {
	if explicitPath != "" {
		// Check if path exists
		if _, err := os.Stat(explicitPath); os.IsNotExist(err) {
			return "", fmt.Errorf("file not found: %s", explicitPath)
		}
		return explicitPath, nil
	}

	// Search for default files in current directory
	cwd, err := os.Getwd()
	if err != nil {
		return "", errors.Wrap(err, "failed to get current directory")
	}

	// Try default file names
	candidates := []string{DefaultFileName, AlternateFileName}
	for _, candidate := range candidates {
		path := filepath.Join(cwd, candidate)
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("no MCP server configuration found\n\nLooking for: %s or %s in current directory\n\nCreate a configuration file or specify a path: stigmer mcpserver apply <file>",
		DefaultFileName, AlternateFileName)
}

// parseContent parses YAML or JSON content into an McpServer proto message.
// It automatically detects the format based on content or file extension.
func parseContent(content []byte, filePath string) (*mcpserverv1.McpServer, error) {
	// Determine format from file extension
	ext := strings.ToLower(filepath.Ext(filePath))
	isJSON := ext == ".json"

	var jsonBytes []byte
	var err error

	if isJSON {
		jsonBytes = content
	} else {
		// Parse YAML to intermediate map, then convert to JSON for protojson
		var intermediate map[string]interface{}
		if err = yaml.Unmarshal(content, &intermediate); err != nil {
			return nil, errors.Wrapf(err, "failed to parse YAML from %s", filePath)
		}

		// Convert to JSON for protojson unmarshaling
		jsonBytes, err = yamlMapToJSON(intermediate)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to convert YAML to JSON from %s", filePath)
		}
	}

	// Use protojson to unmarshal into the proto message
	mcpServer := &mcpserverv1.McpServer{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false, // Strict parsing - reject unknown fields
	}

	if err = unmarshaler.Unmarshal(jsonBytes, mcpServer); err != nil {
		return nil, errors.Wrapf(err, "failed to parse MCP server configuration from %s", filePath)
	}

	// Validate required fields
	if err = validateMcpServer(mcpServer); err != nil {
		return nil, errors.Wrapf(err, "invalid MCP server configuration in %s", filePath)
	}

	return mcpServer, nil
}

// yamlMapToJSON converts a YAML map to JSON bytes.
// This handles the conversion of YAML-specific types to JSON-compatible types.
func yamlMapToJSON(m map[string]interface{}) ([]byte, error) {
	// Convert YAML map keys to strings and handle special types
	converted := convertYAMLValue(m)

	// Use standard JSON marshaling
	return marshalToJSON(converted)
}

// convertYAMLValue recursively converts YAML values to JSON-compatible values.
func convertYAMLValue(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{})
		for k, v := range val {
			result[k] = convertYAMLValue(v)
		}
		return result
	case map[interface{}]interface{}:
		// YAML sometimes produces map[interface{}]interface{}
		result := make(map[string]interface{})
		for k, v := range val {
			keyStr := fmt.Sprintf("%v", k)
			result[keyStr] = convertYAMLValue(v)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(val))
		for i, v := range val {
			result[i] = convertYAMLValue(v)
		}
		return result
	default:
		return val
	}
}

// marshalToJSON marshals a value to JSON bytes.
func marshalToJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

// validateMcpServer performs basic validation on the parsed MCP server.
func validateMcpServer(mcpServer *mcpserverv1.McpServer) error {
	if mcpServer.ApiVersion == "" {
		return fmt.Errorf("apiVersion is required (expected: agentic.stigmer.ai/v1)")
	}

	if mcpServer.ApiVersion != "agentic.stigmer.ai/v1" {
		return fmt.Errorf("invalid apiVersion: %s (expected: agentic.stigmer.ai/v1)", mcpServer.ApiVersion)
	}

	if mcpServer.Kind == "" {
		return fmt.Errorf("kind is required (expected: McpServer)")
	}

	if mcpServer.Kind != "McpServer" {
		return fmt.Errorf("invalid kind: %s (expected: McpServer)", mcpServer.Kind)
	}

	if mcpServer.Metadata == nil {
		return fmt.Errorf("metadata is required")
	}

	if mcpServer.Metadata.Name == "" {
		return fmt.Errorf("metadata.name is required")
	}

	if mcpServer.Spec == nil {
		return fmt.Errorf("spec is required")
	}

	// Validate server_type is specified
	if mcpServer.Spec.GetStdio() == nil &&
		mcpServer.Spec.GetHttp() == nil &&
		mcpServer.Spec.GetDocker() == nil {
		return fmt.Errorf("spec must specify one of: stdio, http, or docker")
	}

	// Validate stdio config if present
	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		if stdio.Command == "" {
			return fmt.Errorf("spec.stdio.command is required")
		}
	}

	// Validate http config if present
	if http := mcpServer.Spec.GetHttp(); http != nil {
		if http.Url == "" {
			return fmt.Errorf("spec.http.url is required")
		}
	}

	// Validate docker config if present
	if docker := mcpServer.Spec.GetDocker(); docker != nil {
		if docker.Image == "" {
			return fmt.Errorf("spec.docker.image is required")
		}
	}

	return nil
}
