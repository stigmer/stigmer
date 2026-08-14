package valueobject

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

// searchDecisionPending lists kinds the proto declares search-indexed
// (not_search_indexed: false) that are deliberately NOT in SearchableKinds
// yet: indexed on write, but awaiting an explicit read-side decision before
// becoming queryable. Every entry must cite the issue that owns the
// decision. Resolving a kind means moving it into SearchableKinds — or
// flipping its proto annotation — and deleting its row here.
//
// Empty since stigmer/stigmer#439 resolved the last six (full parity with
// the proto contract, matching cloud) and flipped artifact's annotation to
// truth (no extractor exists in either edition). The mechanism stays: a
// future kind declared search-indexed before its read surface is designed
// parks here instead of shipping the silently-empty read path that
// environment, project, and session each shipped with (#310 class).
var searchDecisionPending = map[apiresourcekind.ApiResourceKind]string{}

// TestSearchableKinds_CoverSearchIndexedProtoKinds pins SearchableKinds
// against SearchIndexedKinds — the proto-derived set of kinds this edition's
// read side must serve (declared search-indexed, not cloud-only).
//
// The contract, in both directions:
//   - Every derived kind is either served (SearchableKinds) or explicitly
//     parked with an issue citation (searchDecisionPending) — never silently
//     absent, and never both.
//   - Nothing outside the derived set appears in either map: an allowlist or
//     pending entry for a not_search_indexed or cloud-only kind is stale the
//     moment the proto says so.
//
// The defect this kills: a kind whose extractor indexes every write while
// the allowlist silently drops every read shipped three separate times
// (environment and project, fixed in cd141a8be; session,
// stigmer/stigmer#310). Nothing cross-checked the layers, so each gap was
// invisible until a consumer noticed an empty list. Declaring a kind
// search-indexed in the proto now forces an explicit read-side decision
// before this suite goes green.
func TestSearchableKinds_CoverSearchIndexedProtoKinds(t *testing.T) {
	// SearchIndexedKinds skips kinds whose kind_meta cannot be read; fail
	// them here so a registry defect is a red test, not a derivation hole.
	for value := range apiresourcekind.ApiResourceKind_name {
		kind := apiresourcekind.ApiResourceKind(value)
		if kind == apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
			continue
		}
		if _, err := apiresource.GetKindMeta(kind); err != nil {
			t.Errorf("kind %s: reading kind_meta failed: %v", kind, err)
		}
	}

	derived := make(map[apiresourcekind.ApiResourceKind]bool)
	for _, kind := range SearchIndexedKinds() {
		derived[kind] = true

		issue, pending := searchDecisionPending[kind]
		switch {
		case SearchableKinds[kind] && pending:
			t.Errorf("kind %s: present in SearchableKinds AND searchDecisionPending — the decision landed, remove the pending row", kind)
		case !SearchableKinds[kind] && !pending:
			t.Errorf(
				"kind %s: declared search-indexed (not_search_indexed: false) but absent from both SearchableKinds and searchDecisionPending — "+
					"its writes are indexed while reads silently drop the kind (a request for it alone returns empty; "+
					"it degrading to discover mode instead was stigmer/stigmer#440). "+
					"This is the environment/project/session defect (stigmer/stigmer#310). "+
					"Add it to SearchableKinds or record the pending decision with an issue citation",
				kind,
			)
		case pending && issue == "":
			t.Errorf("kind %s: searchDecisionPending entry has no issue citation", kind)
		}
	}

	for kind := range SearchableKinds {
		if !derived[kind] {
			t.Errorf(
				"kind %s: in SearchableKinds but not derivable from the proto (not_search_indexed, cloud_only, or unreadable kind_meta) — "+
					"the OSS server cannot honestly serve it; flip the annotation or drop the entry",
				kind,
			)
		}
	}
	for kind := range searchDecisionPending {
		if !derived[kind] {
			t.Errorf(
				"kind %s: searchDecisionPending row is stale — the proto no longer declares it an OSS-servable search-indexed kind; remove the row",
				kind,
			)
		}
	}
}
