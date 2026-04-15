// Package project provides CLI utilities for managing Project resources.
// It handles YAML/JSON parsing and validation for Project configurations.
package project

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/yamlutil"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
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

// LoadOptions contains options for loading a Project configuration.
type LoadOptions struct {
	// FilePath is the path to the YAML/JSON file (required).
	// The file can have any name - validation is based on content (apiVersion, kind).
	FilePath string
}

// LoadResult contains the result of loading a Project configuration.
type LoadResult struct {
	// Project is the parsed Project proto message.
	Project *projectv1.Project
	// SourcePath is the path to the file that was loaded.
	SourcePath string
}

// Load loads a Project configuration from a YAML or JSON file.
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

	project, err := parseContent(content, filePath)
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		Project:    project,
		SourcePath: filePath,
	}, nil
}

// LoadFromBytes loads a Project configuration from raw YAML/JSON bytes.
// Used when content is already in memory (e.g., from multi-doc YAML).
func LoadFromBytes(content []byte) (*LoadResult, error) {
	project, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		Project:    project,
		SourcePath: "memory",
	}, nil
}

// resolveFilePath validates that the file path is provided and exists.
func resolveFilePath(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("file path is required\n\nUsage: stigmer project validate <file>\n\nThe file can be YAML or JSON with apiVersion: tenancy.stigmer.ai/v1 and kind: Project")
	}

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", fmt.Errorf("file not found: %s", filePath)
	}

	return filePath, nil
}

// parseContent parses YAML or JSON content into a Project proto message.
func parseContent(content []byte, filePath string) (*projectv1.Project, error) {
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
	project := &projectv1.Project{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false, // Strict parsing - reject unknown fields
	}

	if err = unmarshaler.Unmarshal(jsonBytes, project); err != nil {
		return nil, errors.Wrapf(err, "failed to parse Project configuration from %s", filePath)
	}

	// Validate using protovalidate - single source of truth for schema rules
	if err = validator.Validate(project); err != nil {
		return nil, errors.Wrapf(err, "project validation failed in %s", filePath)
	}

	return project, nil
}
