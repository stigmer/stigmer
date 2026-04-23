package main

import (
	"google.golang.org/protobuf/proto"
	descriptorpb "google.golang.org/protobuf/types/descriptorpb"

	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// apiResourceKindEnumNames maps ApiResourceKind proto enum numeric values to
// their lowercase constant names (e.g. 43 -> "skill"). Derived at init time
// from the generated proto stubs so it never drifts from api_resource_kind.proto.
//
// Used by MCP and SDK codegens to emit typed kind constants.
var apiResourceKindEnumNames map[int32]string

// versionedKinds tracks which resource kinds support versioning. Derived at
// init time from the kind_meta.is_versioned extension on each enum value.
var versionedKinds map[int32]bool

func init() {
	apiResourceKindEnumNames = make(map[int32]string, len(apiresourcekind.ApiResourceKind_name))
	for num, name := range apiresourcekind.ApiResourceKind_name {
		apiResourceKindEnumNames[num] = name
	}

	versionedKinds = make(map[int32]bool)
	enumDesc := apiresourcekind.ApiResourceKind(0).Descriptor().Values()
	for i := 0; i < enumDesc.Len(); i++ {
		val := enumDesc.Get(i)
		opts := val.Options().(*descriptorpb.EnumValueOptions)
		if opts == nil {
			continue
		}
		ext := proto.GetExtension(opts, apiresourcekind.E_KindMeta)
		meta, ok := ext.(*apiresourcekind.ApiResourceKindMeta)
		if ok && meta != nil && meta.IsVersioned {
			versionedKinds[int32(val.Number())] = true
		}
	}
}
