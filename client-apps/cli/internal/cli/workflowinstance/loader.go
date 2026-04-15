// Package workflowinstance provides CLI utilities for managing WorkflowInstance resources.
package workflowinstance

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/yamlutil"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

var validator protovalidate.Validator

func init() {
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// LoadResult contains the result of loading a WorkflowInstance configuration.
type LoadResult struct {
	WorkflowInstance *workflowinstancev1.WorkflowInstance
	SourcePath       string
}

// LoadFromBytes loads a WorkflowInstance configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	wi, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		WorkflowInstance: wi,
		SourcePath:       "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*workflowinstancev1.WorkflowInstance, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	isJSON := ext == ".json"

	var jsonBytes []byte
	var err error

	if isJSON {
		jsonBytes = content
	} else {
		var intermediate map[string]interface{}
		if err = yaml.Unmarshal(content, &intermediate); err != nil {
			return nil, errors.Wrapf(err, "failed to parse YAML from %s", filePath)
		}

		jsonBytes, err = yamlutil.MapToJSON(intermediate)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to convert YAML to JSON from %s", filePath)
		}
	}

	wi := &workflowinstancev1.WorkflowInstance{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, wi); err != nil {
		return nil, errors.Wrapf(err, "failed to parse WorkflowInstance configuration from %s", filePath)
	}

	if err = validator.Validate(wi); err != nil {
		return nil, errors.Wrapf(err, "workflow instance validation failed in %s", filePath)
	}

	return wi, nil
}
