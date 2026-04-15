// Package oauthapp provides CLI utilities for managing OAuthApp resources.
package oauthapp

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
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

// LoadResult contains the result of loading an OAuthApp configuration.
type LoadResult struct {
	OAuthApp   *oauthappv1.OAuthApp
	SourcePath string
}

// LoadFromBytes loads an OAuthApp configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	app, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		OAuthApp:   app,
		SourcePath: "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*oauthappv1.OAuthApp, error) {
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

	app := &oauthappv1.OAuthApp{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, app); err != nil {
		return nil, errors.Wrapf(err, "failed to parse OAuthApp configuration from %s", filePath)
	}

	if err = validator.Validate(app); err != nil {
		return nil, errors.Wrapf(err, "oauth app validation failed in %s", filePath)
	}

	return app, nil
}
