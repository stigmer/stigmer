// Package organization provides CLI utilities for managing Organization resources.
package organization

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
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

// LoadResult contains the result of loading an Organization configuration.
type LoadResult struct {
	Organization *organizationv1.Organization
	SourcePath   string
}

// LoadFromBytes loads an Organization configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	org, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		Organization: org,
		SourcePath:   "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*organizationv1.Organization, error) {
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

	org := &organizationv1.Organization{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, org); err != nil {
		return nil, errors.Wrapf(err, "failed to parse Organization configuration from %s", filePath)
	}

	if err = validator.Validate(org); err != nil {
		return nil, errors.Wrapf(err, "organization validation failed in %s", filePath)
	}

	return org, nil
}
