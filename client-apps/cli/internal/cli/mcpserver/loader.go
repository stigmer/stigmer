// Package mcpserver provides CLI utilities for managing MCP server resources.
// It handles YAML/JSON parsing and apply operations for McpServer configurations.
package mcpserver

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/yamlutil"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// LoadOptions contains options for loading an MCP server configuration
type LoadOptions struct {
	// FilePath is the path to the YAML/JSON file (required).
	// The file can have any name - validation is based on content (apiVersion, kind).
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
// The file path is required - validation is based on content (apiVersion, kind).
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

// LoadFromBytes loads an MCP server configuration from raw YAML/JSON bytes.
// Used when content is already in memory (e.g., from multi-doc YAML).
func LoadFromBytes(content []byte) (*LoadResult, error) {
	mcpServer, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		McpServer:  mcpServer,
		SourcePath: "memory",
	}, nil
}

// resolveFilePath validates that the file path is provided and exists.
func resolveFilePath(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("file path is required\n\nUsage: stigmer mcpserver apply <file>\n\nThe file can be YAML or JSON with apiVersion: agentic.stigmer.ai/v1 and kind: McpServer")
	}

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", fmt.Errorf("file not found: %s", filePath)
	}

	return filePath, nil
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

		jsonBytes, err = yamlutil.MapToJSON(intermediate)
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
		mcpServer.Spec.GetHttp() == nil {
		return fmt.Errorf("spec must specify one of: stdio or http")
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

	return nil
}
