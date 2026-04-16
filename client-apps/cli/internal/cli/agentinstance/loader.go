// Package agentinstance provides CLI utilities for managing AgentInstance resources.
package agentinstance

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/yamlutil"
	agentinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentinstance/v1"
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

// LoadResult contains the result of loading an AgentInstance configuration.
type LoadResult struct {
	AgentInstance *agentinstancev1.AgentInstance
	SourcePath    string
}

// LoadFromBytes loads an AgentInstance configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	ai, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		AgentInstance: ai,
		SourcePath:    "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*agentinstancev1.AgentInstance, error) {
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

	ai := &agentinstancev1.AgentInstance{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, ai); err != nil {
		return nil, errors.Wrapf(err, "failed to parse AgentInstance configuration from %s", filePath)
	}

	if err = validator.Validate(ai); err != nil {
		return nil, errors.Wrapf(err, "agent instance validation failed in %s", filePath)
	}

	return ai, nil
}
