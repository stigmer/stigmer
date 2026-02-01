// Package agent provides CLI utilities for managing Agent resources.
// It handles YAML/JSON parsing and validation for Agent configurations.
package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

const (
	// DefaultFileName is the default name for Agent configuration files.
	DefaultFileName = "agent.yaml"
	// AlternateFileName is an alternate name for Agent configuration files.
	AlternateFileName = "AGENT.yaml"
)

// validator is the package-level protovalidate validator instance.
// Initialized once at package load time for efficiency.
var validator protovalidate.Validator

func init() {
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// LoadOptions contains options for loading an Agent configuration.
type LoadOptions struct {
	// FilePath is the path to the YAML/JSON file (optional, auto-detects if empty).
	FilePath string
}

// LoadResult contains the result of loading an Agent configuration.
type LoadResult struct {
	// Agent is the parsed Agent proto message.
	Agent *agentv1.Agent
	// SourcePath is the path to the file that was loaded.
	SourcePath string
}

// Load loads an Agent configuration from a YAML or JSON file.
// If opts.FilePath is empty, it searches for agent.yaml or AGENT.yaml
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

	agent, err := parseContent(content, filePath)
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		Agent:      agent,
		SourcePath: filePath,
	}, nil
}

// resolveFilePath resolves the file path to load from.
// If explicit path is provided, uses that. Otherwise, searches for default files.
func resolveFilePath(explicitPath string) (string, error) {
	if explicitPath != "" {
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

	candidates := []string{DefaultFileName, AlternateFileName}
	for _, candidate := range candidates {
		path := filepath.Join(cwd, candidate)
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("no Agent configuration found\n\nLooking for: %s or %s in current directory\n\nCreate a configuration file or specify a path: stigmer agent apply <file>",
		DefaultFileName, AlternateFileName)
}

// parseContent parses YAML or JSON content into an Agent proto message.
func parseContent(content []byte, filePath string) (*agentv1.Agent, error) {
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

		jsonBytes, err = yamlMapToJSON(intermediate)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to convert YAML to JSON from %s", filePath)
		}
	}

	// Use protojson to unmarshal into the proto message
	agent := &agentv1.Agent{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false, // Strict parsing - reject unknown fields
	}

	if err = unmarshaler.Unmarshal(jsonBytes, agent); err != nil {
		return nil, errors.Wrapf(err, "failed to parse Agent configuration from %s", filePath)
	}

	// Validate using protovalidate - single source of truth for schema rules
	if err = validator.Validate(agent); err != nil {
		return nil, errors.Wrapf(err, "agent validation failed in %s", filePath)
	}

	return agent, nil
}

// yamlMapToJSON converts a YAML map to JSON bytes.
func yamlMapToJSON(m map[string]interface{}) ([]byte, error) {
	converted := convertYAMLValue(m)
	return json.Marshal(converted)
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
