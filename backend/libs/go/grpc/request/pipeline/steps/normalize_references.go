package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const apiResourceReferenceFullName = "ai.stigmer.commons.apiresource.ApiResourceReference"

// NormalizeReferencesStep resolves empty org fields in ApiResourceReference
// messages within a resource's spec at write time.
//
// When a user authors a resource with cross-references (e.g., skill_refs,
// mcp_server_usages), they can omit org for same-org references. This step
// fills empty org from the resource's own metadata.org, ensuring all stored
// references are absolute (fully qualified).
//
// Scope:
//   - Only walks the "spec" field (user-authored). Status fields are
//     system-generated and already absolute.
//   - Only fills empty org. Explicit org values are preserved (cross-org refs).
//   - No-op for resources without a spec field or without ApiResourceReference
//     fields in their spec.
//
// Placement: After BuildNewState/BuildUpdateState (metadata is finalized),
// before Persist (references are resolved before storage).
type NormalizeReferencesStep[T proto.Message] struct{}

// NewNormalizeReferencesStep creates a new NormalizeReferencesStep.
func NewNormalizeReferencesStep[T proto.Message]() *NormalizeReferencesStep[T] {
	return &NormalizeReferencesStep[T]{}
}

func (s *NormalizeReferencesStep[T]) Name() string {
	return "NormalizeReferences"
}

func (s *NormalizeReferencesStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	defaultOrg := metadata.Org
	if defaultOrg == "" {
		// No org to resolve from — skip normalization silently.
		// This is not an error: validation of required metadata.org
		// is the responsibility of the validation step, not this one.
		return nil
	}

	ResolveEmptyOrgInSpec(resource, defaultOrg)
	return nil
}

// ResolveEmptyOrgInSpec finds the "spec" field on a proto message and
// recursively fills empty org values in any ApiResourceReference sub-messages.
//
// This function is exported so that domain-specific code outside the pipeline
// framework can reuse the normalization logic.
func ResolveEmptyOrgInSpec(resource proto.Message, defaultOrg string) {
	msg := resource.ProtoReflect()
	specField := msg.Descriptor().Fields().ByName("spec")
	if specField == nil || specField.Kind() != protoreflect.MessageKind {
		return
	}
	if !msg.Has(specField) {
		return
	}
	specMsg := msg.Mutable(specField).Message()
	walkAndResolveOrg(specMsg, defaultOrg)
}

// walkAndResolveOrg recursively walks a protobuf message and fills empty org
// values in any ApiResourceReference sub-messages it encounters.
func walkAndResolveOrg(msg protoreflect.Message, defaultOrg string) {
	fields := msg.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		if fd.Kind() != protoreflect.MessageKind {
			continue
		}

		if fd.IsList() {
			walkRepeatedField(msg, fd, defaultOrg)
		} else if fd.IsMap() {
			walkMapField(msg, fd, defaultOrg)
		} else {
			walkSingularField(msg, fd, defaultOrg)
		}
	}
}

func walkSingularField(msg protoreflect.Message, fd protoreflect.FieldDescriptor, defaultOrg string) {
	if !msg.Has(fd) {
		return
	}
	sub := msg.Mutable(fd).Message()
	if isApiResourceReference(sub.Descriptor()) {
		resolveOrg(sub, defaultOrg)
	} else {
		walkAndResolveOrg(sub, defaultOrg)
	}
}

func walkRepeatedField(msg protoreflect.Message, fd protoreflect.FieldDescriptor, defaultOrg string) {
	list := msg.Mutable(fd).List()
	for j := 0; j < list.Len(); j++ {
		elem := list.Get(j).Message()
		if isApiResourceReference(elem.Descriptor()) {
			resolveOrg(elem, defaultOrg)
		} else {
			walkAndResolveOrg(elem, defaultOrg)
		}
	}
}

func walkMapField(msg protoreflect.Message, fd protoreflect.FieldDescriptor, defaultOrg string) {
	if fd.MapValue().Kind() != protoreflect.MessageKind {
		return
	}
	mapValue := msg.Mutable(fd).Map()
	mapValue.Range(func(k protoreflect.MapKey, v protoreflect.Value) bool {
		elem := v.Message()
		if isApiResourceReference(elem.Descriptor()) {
			resolveOrg(elem, defaultOrg)
		} else {
			walkAndResolveOrg(elem, defaultOrg)
		}
		return true
	})
}

func isApiResourceReference(desc protoreflect.MessageDescriptor) bool {
	return string(desc.FullName()) == apiResourceReferenceFullName
}

func resolveOrg(ref protoreflect.Message, defaultOrg string) {
	orgField := ref.Descriptor().Fields().ByName("org")
	if orgField == nil {
		return
	}
	if ref.Get(orgField).String() == "" {
		ref.Set(orgField, protoreflect.ValueOfString(defaultOrg))
	}
}
