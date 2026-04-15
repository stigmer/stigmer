package root

import (
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// buildResourceReference creates an ApiResourceReference from resource metadata and kind.
func buildResourceReference(
	metadata *apiresource.ApiResourceMetadata,
	kind apiresourcekind.ApiResourceKind,
) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  metadata.Org,
		Kind: kind,
		Slug: metadata.Slug,
	}
}

// warnOrgMismatch logs a warning when a resource has an explicit metadata.org
// that differs from the resolved project/context org. This catches accidental
// hardcoded org values in resource YAMLs (e.g. leftover "org: default") that
// would silently place the resource in a different organization than intended.
//
// No warning is emitted when the resource org is empty (normal inheritance)
// or when no resolved org is available (e.g. file-mode Organization apply).
func warnOrgMismatch(kind string, metadata *apiresource.ApiResourceMetadata, resolvedOrg string) {
	if metadata == nil || resolvedOrg == "" || metadata.Org == "" {
		return
	}
	if metadata.Org != resolvedOrg {
		climsg.Warning("%s '%s' has explicit org '%s' (resolved org: '%s')",
			kind, metadata.GetName(), metadata.Org, resolvedOrg)
	}
}
