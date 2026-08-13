package apiresource

import (
	"fmt"
	"strings"
	"sync"

	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// GetKindEnum returns the ApiResourceKind enum value for a given proto message.
// It extracts the kind from the message's "kind" field and maps it to the enum.
//
// Resolution goes through the kind_meta.name each enum value declares in the
// proto — the only source that knows a kind's true word boundaries — rather
// than re-deriving the enum name from PascalCase, which cannot recover
// "oauth_app" from "OAuthApp" (stigmer/stigmer#545). Matching is canonical
// (case-insensitive, underscores ignored); this mirrors Cloud's
// ApiResourceKindExtractor.extract so both editions resolve the same kind
// strings from the same proto metadata.
//
// Example:
//
//	agent := &agentv1.Agent{Kind: "Agent"}
//	kind := GetKindEnum(agent) // Returns ApiResourceKind_agent
func GetKindEnum(msg proto.Message) (apiresourcekind.ApiResourceKind, error) {
	if msg == nil {
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown, fmt.Errorf("message is nil")
	}

	// Get the kind field value from the message
	msgReflect := msg.ProtoReflect()
	kindFieldDesc := msgReflect.Descriptor().Fields().ByName("kind")
	if kindFieldDesc == nil {
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown, fmt.Errorf("message does not have a 'kind' field")
	}

	kindValue := msgReflect.Get(kindFieldDesc).String()
	if kindValue == "" {
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown, fmt.Errorf("kind field is empty")
	}

	kind, ok := kindsByCanonicalName()[canonicalKindName(kindValue)]
	if !ok {
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown, fmt.Errorf("unknown kind: %s", kindValue)
	}

	return kind, nil
}

// canonicalKindName normalizes a kind name so different spellings compare
// equal: "OAuthApp", "oauth_app" and "OAUTHAPP" all canonicalize to
// "oauthapp". Twin of the canonical() helper in Cloud's
// ApiResourceKindExtractor — the two must stay in sync so both editions
// accept and reject the same spellings.
func canonicalKindName(s string) string {
	return strings.ReplaceAll(strings.ToLower(s), "_", "")
}

var (
	kindsByCanonicalNameOnce sync.Once
	kindsByCanonicalNameMap  map[string]apiresourcekind.ApiResourceKind
)

// kindsByCanonicalName lazily builds the canonical kind_meta.name → enum
// lookup by walking the ApiResourceKind enum values through proto reflection.
// Values without kind_meta (only the unknown zero value) are skipped. The
// proto is the single source of truth, so a newly added kind is resolvable
// with no code change here; TestGetKindEnumResolvesEveryDeclaredKind pins
// that property.
func kindsByCanonicalName() map[string]apiresourcekind.ApiResourceKind {
	kindsByCanonicalNameOnce.Do(func() {
		values := apiresourcekind.ApiResourceKind(0).Descriptor().Values()
		m := make(map[string]apiresourcekind.ApiResourceKind, values.Len())
		for i := 0; i < values.Len(); i++ {
			valueDesc := values.Get(i)
			opts := valueDesc.Options()
			if opts == nil || !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
				continue
			}
			meta := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
			m[canonicalKindName(meta.GetName())] = apiresourcekind.ApiResourceKind(valueDesc.Number())
		}
		kindsByCanonicalNameMap = m
	})
	return kindsByCanonicalNameMap
}

// GetKindMeta returns the ApiResourceKindMeta for a given ApiResourceKind enum value.
// This extracts the metadata from the proto enum value options.
//
// Example:
//
//	meta, err := GetKindMeta(apiresourcekind.ApiResourceKind_agent)
//	// meta.IdPrefix == "agt"
//	// meta.Name == "Agent"
func GetKindMeta(kind apiresourcekind.ApiResourceKind) (*apiresourcekind.ApiResourceKindMeta, error) {
	// Get the enum descriptor
	enumDesc := kind.Descriptor()

	// Get the value descriptor for the specific enum value
	valueDesc := enumDesc.Values().ByNumber(protoreflect.EnumNumber(kind))
	if valueDesc == nil {
		return nil, fmt.Errorf("enum value not found for kind: %v", kind)
	}

	// Get the extension options
	opts := valueDesc.Options()
	if opts == nil {
		return nil, fmt.Errorf("no options found for kind: %v", kind)
	}

	// Extract the kind_meta extension
	if !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
		return nil, fmt.Errorf("kind_meta extension not found for kind: %v", kind)
	}

	meta := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
	return meta, nil
}

// GetIdPrefix returns the ID prefix for a given ApiResourceKind.
// This is a convenience method that extracts the id_prefix from the kind metadata.
//
// Example:
//
//	prefix, err := GetIdPrefix(apiresourcekind.ApiResourceKind_agent)
//	// prefix == "agt"
func GetIdPrefix(kind apiresourcekind.ApiResourceKind) (string, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return "", err
	}
	return meta.IdPrefix, nil
}

// GetKindName returns the kind name for a given ApiResourceKind.
// This is a convenience method that extracts the name from the kind metadata.
//
// Example:
//
//	name, err := GetKindName(apiresourcekind.ApiResourceKind_agent)
//	// name == "Agent"
func GetKindName(kind apiresourcekind.ApiResourceKind) (string, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return "", err
	}
	return meta.Name, nil
}

// GetDisplayName returns the display name for a given ApiResourceKind.
// This is a convenience method that extracts the display_name from the kind metadata.
//
// Example:
//
//	displayName, err := GetDisplayName(apiresourcekind.ApiResourceKind_agent)
//	// displayName == "Agent"
func GetDisplayName(kind apiresourcekind.ApiResourceKind) (string, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return "", err
	}
	return meta.DisplayName, nil
}

// DefaultVisibilityFor returns the visibility a resource of this kind should take
// when the client leaves metadata.visibility unspecified. Blueprint kinds marked
// defaults_to_org_visibility get visibility_org; all others get visibility_private.
//
// This mirrors Cloud's VisibilityConfigResolver.defaultVisibilityFor so both
// editions derive the same default from the same proto config, keeping the
// cross-edition contract consistent by construction.
func DefaultVisibilityFor(kind apiresourcekind.ApiResourceKind) (apiresourcepb.ApiResourceVisibility, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return apiresourcepb.ApiResourceVisibility_api_resource_visibility_unspecified, err
	}
	if meta.GetAuthorization().GetVisibility().GetDefaultsToOrgVisibility() {
		return apiresourcepb.ApiResourceVisibility_visibility_org, nil
	}
	return apiresourcepb.ApiResourceVisibility_visibility_private, nil
}

// SupportsVisibility reports whether a resource of the given kind may be set
// to the given visibility level, derived from the kind's VisibilityConfig.
//
// PRIVATE and UNSPECIFIED are always supported (they mean "no visibility
// grant"); every other level requires the matching supports_* flag in the
// kind's proto config. Kinds with no VisibilityConfig are private-only.
//
// This mirrors Cloud's VisibilityConfigResolver.supportsVisibility so both
// editions accept and reject the same levels from the same proto config —
// e.g. environments allow org but never public/platform (secret values must
// never be resolvable across the org boundary).
func SupportsVisibility(kind apiresourcekind.ApiResourceKind, visibility apiresourcepb.ApiResourceVisibility) (bool, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return false, err
	}
	cfg := meta.GetAuthorization().GetVisibility()
	switch visibility {
	case apiresourcepb.ApiResourceVisibility_visibility_public:
		return cfg.GetSupportsPublic(), nil
	case apiresourcepb.ApiResourceVisibility_visibility_org:
		return cfg.GetSupportsOrg(), nil
	case apiresourcepb.ApiResourceVisibility_visibility_platform:
		return cfg.GetSupportsPlatform(), nil
	default:
		// PRIVATE / UNSPECIFIED carry no visibility grant — always valid.
		return true, nil
	}
}

// SupportedVisibilityLevels returns a human-readable, comma-joined list of
// the visibility levels a kind supports, always starting with
// visibility_private (every kind supports private). Derived from the same
// proto VisibilityConfig SupportsVisibility reads, so the list can never
// drift from the predicate.
//
// This mirrors Cloud's ValidateVisibilityStep.describeSupportedLevels; both
// editions use it to build the same INVALID_ARGUMENT message when rejecting
// an unsupported level, keeping the cross-edition error contract identical.
func SupportedVisibilityLevels(kind apiresourcekind.ApiResourceKind) (string, error) {
	meta, err := GetKindMeta(kind)
	if err != nil {
		return "", err
	}
	cfg := meta.GetAuthorization().GetVisibility()
	levels := apiresourcepb.ApiResourceVisibility_visibility_private.String()
	if cfg.GetSupportsOrg() {
		levels += ", " + apiresourcepb.ApiResourceVisibility_visibility_org.String()
	}
	if cfg.GetSupportsPublic() {
		levels += ", " + apiresourcepb.ApiResourceVisibility_visibility_public.String()
	}
	if cfg.GetSupportsPlatform() {
		levels += ", " + apiresourcepb.ApiResourceVisibility_visibility_platform.String()
	}
	return levels, nil
}
