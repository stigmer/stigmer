// Package identityprovider provides CLI utilities for managing IdentityProvider resources.
package identityprovider

import (
	"fmt"
	"path/filepath"
	"strings"

	"buf.build/go/protovalidate"
	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/yamlutil"
	identityproviderv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/identityprovider/v1"
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

// LoadResult contains the result of loading an IdentityProvider configuration.
type LoadResult struct {
	IdentityProvider *identityproviderv1.IdentityProvider
	SourcePath       string
}

// LoadFromBytes loads an IdentityProvider configuration from raw YAML/JSON bytes.
func LoadFromBytes(content []byte) (*LoadResult, error) {
	idp, err := parseContent(content, "memory")
	if err != nil {
		return nil, err
	}

	return &LoadResult{
		IdentityProvider: idp,
		SourcePath:       "memory",
	}, nil
}

func parseContent(content []byte, filePath string) (*identityproviderv1.IdentityProvider, error) {
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

	idp := &identityproviderv1.IdentityProvider{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err = unmarshaler.Unmarshal(jsonBytes, idp); err != nil {
		return nil, errors.Wrapf(err, "failed to parse IdentityProvider configuration from %s", filePath)
	}

	if err = validator.Validate(idp); err != nil {
		return nil, errors.Wrapf(err, "identity provider validation failed in %s", filePath)
	}

	return idp, nil
}
