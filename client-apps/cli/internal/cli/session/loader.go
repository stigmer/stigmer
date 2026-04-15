// Package session provides CLI utilities for managing Session resources.
package session

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
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

// LoadResult contains the result of loading a Session configuration.
type LoadResult struct {
	Session    *sessionv1.Session
	SourcePath string
}

// LoadFromBytes loads a Session configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	s, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		Session:    s,
		SourcePath: "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*sessionv1.Session, error) {
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

	s := &sessionv1.Session{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, s); err != nil {
		return nil, errors.Wrapf(err, "failed to parse Session configuration from %s", filePath)
	}

	if err = validator.Validate(s); err != nil {
		return nil, errors.Wrapf(err, "session validation failed in %s", filePath)
	}

	return s, nil
}
