package kindmeta

import (
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// GetMeta returns the ApiResourceKindMeta for a given ApiResourceKind.
// The metadata is extracted from the proto enum value's custom options.
func GetMeta(kind apiresourcekind.ApiResourceKind) (*apiresourcekind.ApiResourceKindMeta, error) {
	valueDesc := kind.Descriptor().Values().ByNumber(protoreflect.EnumNumber(kind))
	if valueDesc == nil {
		return nil, fmt.Errorf("enum value not found for kind: %v", kind)
	}

	opts := valueDesc.Options()
	if opts == nil {
		return nil, fmt.Errorf("no options found for kind: %v", kind)
	}

	if !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
		return nil, fmt.Errorf("kind_meta extension not found for kind: %v", kind)
	}

	return proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta), nil
}

// GetIDPrefix returns the ID prefix (e.g. "agt", "ses") for a given kind.
func GetIDPrefix(kind apiresourcekind.ApiResourceKind) (string, error) {
	meta, err := GetMeta(kind)
	if err != nil {
		return "", err
	}
	return meta.IdPrefix, nil
}
