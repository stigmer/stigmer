package reconcile

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// apiResourceReferenceType is the full proto type name for ApiResourceReference.
// Used for type matching during message tree traversal.
const apiResourceReferenceType = "ai.stigmer.commons.apiresource.ApiResourceReference"

// refKey is used internally for deduplication of discovered references.
// Two references are considered equal if all four fields match.
type refKey struct {
	org     string
	kind    int32
	slug    string
	version string
}

// DiscoverDependencies finds all ApiResourceReference messages in a proto message tree.
//
// This function implements schema-driven discovery using proto reflection. It recursively
// walks the entire message structure, finding references at any nesting level without
// hardcoded field paths. This follows the Open/Closed Principle - adding new reference
// fields to any proto works automatically.
//
// The discovery algorithm:
//  1. For each field in the message, check if it's a nested MESSAGE type
//  2. If the message type is ApiResourceReference, extract and add to results
//  3. Otherwise, recurse into the nested message
//  4. Handle repeated fields by iterating over all items
//
// Returns a deduplicated slice of discovered references. Returns an empty slice
// (not nil) if no references are found or if the resource is nil.
//
// Example:
//
//	agent := &agentv1.Agent{...}
//	refs := DiscoverDependencies(agent)
//	for _, ref := range refs {
//	    fmt.Printf("Found reference: %s/%s\n", ref.GetKind(), ref.GetSlug())
//	}
func DiscoverDependencies(resource proto.Message) []*apiresource.ApiResourceReference {
	if resource == nil {
		return []*apiresource.ApiResourceReference{}
	}

	seen := make(map[refKey]struct{})
	var results []*apiresource.ApiResourceReference

	walkMessage(resource.ProtoReflect(), seen, &results)

	return results
}

// walkMessage recursively traverses a proto message, collecting ApiResourceReference fields.
//
// Uses msg.Range() to iterate only over populated fields, which is more efficient
// than iterating over all declared fields.
func walkMessage(msg protoreflect.Message, seen map[refKey]struct{}, results *[]*apiresource.ApiResourceReference) {
	msg.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		if fd.IsList() {
			// Handle repeated fields (lists)
			list := v.List()
			for i := 0; i < list.Len(); i++ {
				processValue(list.Get(i), fd, seen, results)
			}
		} else if fd.IsMap() {
			// Handle map fields - iterate over values
			v.Map().Range(func(_ protoreflect.MapKey, mv protoreflect.Value) bool {
				processValue(mv, fd.MapValue(), seen, results)
				return true
			})
		} else {
			processValue(v, fd, seen, results)
		}
		return true // Continue iteration
	})
}

// processValue processes a single field value, either extracting a reference or recursing.
func processValue(v protoreflect.Value, fd protoreflect.FieldDescriptor, seen map[refKey]struct{}, results *[]*apiresource.ApiResourceReference) {
	// Skip primitives and enums - only process nested messages
	if fd.Kind() != protoreflect.MessageKind {
		return
	}

	msg := v.Message()
	typeName := string(msg.Descriptor().FullName())

	if typeName == apiResourceReferenceType {
		// Found an ApiResourceReference - extract and add
		ref := extractReference(msg)
		if ref != nil && isValidReference(ref) {
			key := toRefKey(ref)
			if _, exists := seen[key]; !exists {
				seen[key] = struct{}{}
				*results = append(*results, ref)
			}
		}
	} else {
		// Not a reference type - recurse into nested message
		walkMessage(msg, seen, results)
	}
}

// extractReference converts a dynamically-typed proto message to an ApiResourceReference.
//
// The message is expected to be an ApiResourceReference but is received as a
// generic protoreflect.Message due to the reflection-based traversal. We extract
// fields by name to build a properly-typed ApiResourceReference instance.
func extractReference(msg protoreflect.Message) *apiresource.ApiResourceReference {
	desc := msg.Descriptor()

	// Extract org field
	org := ""
	if orgField := desc.Fields().ByName("org"); orgField != nil && msg.Has(orgField) {
		org = msg.Get(orgField).String()
	}

	// Extract slug field
	slug := ""
	if slugField := desc.Fields().ByName("slug"); slugField != nil && msg.Has(slugField) {
		slug = msg.Get(slugField).String()
	}

	// Extract kind field (enum)
	kind := apiresourcekind.ApiResourceKind_api_resource_kind_unknown
	if kindField := desc.Fields().ByName("kind"); kindField != nil && msg.Has(kindField) {
		kindNum := msg.Get(kindField).Enum()
		kind = apiresourcekind.ApiResourceKind(kindNum)
	}

	// Extract version field (optional)
	version := ""
	if versionField := desc.Fields().ByName("version"); versionField != nil && msg.Has(versionField) {
		version = msg.Get(versionField).String()
	}

	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    kind,
		Slug:    slug,
		Version: version,
	}
}

// isValidReference validates that a reference has the minimum required fields.
//
// A valid reference must have at least a non-empty slug. The org and kind provide
// additional context but an empty org defaults to the project's org during
// resolution.
func isValidReference(ref *apiresource.ApiResourceReference) bool {
	if ref == nil {
		return false
	}
	// Slug is required for dependency tracking
	return strings.TrimSpace(ref.GetSlug()) != ""
}

// toRefKey creates a deduplication key from a reference.
func toRefKey(ref *apiresource.ApiResourceReference) refKey {
	return refKey{
		org:     ref.GetOrg(),
		kind:    int32(ref.GetKind()),
		slug:    ref.GetSlug(),
		version: ref.GetVersion(),
	}
}

// ToResourceKey converts an ApiResourceReference to a ResourceKey for use in
// dependency graphs and reconciliation plans.
//
// The key format is "{kind}:{slug}" (e.g., "skill:web-search", "mcp_server:github").
// Returns an error if the reference has an unsupported kind or empty slug.
func ToResourceKey(ref *apiresource.ApiResourceReference) (ResourceKey, error) {
	if ref == nil {
		return ResourceKey{}, nil
	}
	return NewResourceKey(ref.GetKind(), ref.GetSlug())
}
