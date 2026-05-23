package steps

import (
	"fmt"
	"strings"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// ValidateReferencesStep verifies that all ApiResourceReference messages in the
// resource's spec point to existing resources in the store.
//
// Validation strictness:
//   - mcp_server references: strict -- FAILED_PRECONDITION if the referenced
//     MCP server does not exist. Agents cannot function without their declared
//     MCP tools; accepting a broken reference silently leads to runtime failures.
//
// Placement: AFTER NormalizeReferences (org is resolved), BEFORE MergeMcpServerEnvSpecs.
type ValidateReferencesStep[T proto.Message] struct {
	store store.Store
}

// NewValidateReferencesStep creates a new ValidateReferencesStep.
func NewValidateReferencesStep[T proto.Message](s store.Store) *ValidateReferencesStep[T] {
	return &ValidateReferencesStep[T]{store: s}
}

func (s *ValidateReferencesStep[T]) Name() string {
	return "ValidateReferences"
}

func (s *ValidateReferencesStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	// Collect all ApiResourceReferences from the spec
	refs := collectReferences(resource)
	if len(refs) == 0 {
		return nil
	}

	// Validate each reference by kind
	var missingMcpServers []string

	for _, ref := range refs {
		kind := apiresourcekind.ApiResourceKind(ref.kind)
		slug := ref.slug
		org := ref.org

		if slug == "" {
			continue
		}

		switch kind {
		case apiresourcekind.ApiResourceKind_mcp_server:
			_, found, err := FindResourceBySlug[*mcpserverv1.McpServer](
				ctx.Context(), s.store, kind, slug, org,
			)
			if err != nil {
				return fmt.Errorf("failed to validate MCP server reference '%s' (org: %s): %w", slug, org, err)
			}
			if !found {
				missingMcpServers = append(missingMcpServers, fmt.Sprintf("'%s' (org: %s)", slug, org))
			}
		}
	}

	if len(missingMcpServers) > 0 {
		msg := fmt.Sprintf(
			"referenced MCP server(s) not found: %s. "+
				"Verify the slug and org are correct. "+
				"Use 'stigmer get mcp-servers' to list available MCP servers.",
			strings.Join(missingMcpServers, ", "),
		)
		return grpclib.FailedPreconditionError("%s", msg)
	}

	return nil
}

// refInfo holds the extracted fields from an ApiResourceReference.
type refInfo struct {
	kind int32
	slug string
	org  string
}

// collectReferences walks the spec field of a proto message and returns all
// ApiResourceReference instances found. Reuses the same traversal logic as
// NormalizeReferencesStep.
func collectReferences(resource proto.Message) []refInfo {
	msg := resource.ProtoReflect()
	specField := msg.Descriptor().Fields().ByName("spec")
	if specField == nil || specField.Kind() != protoreflect.MessageKind {
		return nil
	}
	if !msg.Has(specField) {
		return nil
	}
	specMsg := msg.Get(specField).Message()
	var refs []refInfo
	walkAndCollectRefs(specMsg, &refs)
	return refs
}

func walkAndCollectRefs(msg protoreflect.Message, refs *[]refInfo) {
	fields := msg.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		if fd.Kind() != protoreflect.MessageKind {
			continue
		}

		if fd.IsList() {
			list := msg.Get(fd).List()
			for j := 0; j < list.Len(); j++ {
				elem := list.Get(j).Message()
				if isApiResourceReference(elem.Descriptor()) {
					*refs = append(*refs, extractRef(elem))
				} else {
					walkAndCollectRefs(elem, refs)
				}
			}
		} else if fd.IsMap() {
			if fd.MapValue().Kind() != protoreflect.MessageKind {
				continue
			}
			mapValue := msg.Get(fd).Map()
			mapValue.Range(func(k protoreflect.MapKey, v protoreflect.Value) bool {
				elem := v.Message()
				if isApiResourceReference(elem.Descriptor()) {
					*refs = append(*refs, extractRef(elem))
				} else {
					walkAndCollectRefs(elem, refs)
				}
				return true
			})
		} else {
			if !msg.Has(fd) {
				continue
			}
			sub := msg.Get(fd).Message()
			if isApiResourceReference(sub.Descriptor()) {
				*refs = append(*refs, extractRef(sub))
			} else {
				walkAndCollectRefs(sub, refs)
			}
		}
	}
}

func extractRef(ref protoreflect.Message) refInfo {
	info := refInfo{}

	if kindField := ref.Descriptor().Fields().ByName("kind"); kindField != nil {
		info.kind = int32(ref.Get(kindField).Enum())
	}
	if slugField := ref.Descriptor().Fields().ByName("slug"); slugField != nil {
		info.slug = ref.Get(slugField).String()
	}
	if orgField := ref.Descriptor().Fields().ByName("org"); orgField != nil {
		info.org = ref.Get(orgField).String()
	}

	return info
}
