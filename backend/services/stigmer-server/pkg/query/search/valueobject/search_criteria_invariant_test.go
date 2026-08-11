package valueobject

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

// searchDecisionPending lists kinds the proto declares search-indexed
// (not_search_indexed: false) that are deliberately NOT in SearchableKinds
// yet: each is indexed on write today but needs its own read-side decision
// before it becomes queryable (should organization be full-text searchable
// in a single-user install? should executions surface in discover mode?).
// Every entry cites the issue tracking that decision. Resolving a kind means
// moving it into SearchableKinds — or flipping its proto annotation — and
// deleting its row here.
var searchDecisionPending = map[apiresourcekind.ApiResourceKind]string{
	apiresourcekind.ApiResourceKind_agent_execution:    "stigmer/stigmer#439",
	apiresourcekind.ApiResourceKind_agent_instance:     "stigmer/stigmer#439",
	apiresourcekind.ApiResourceKind_execution_context:  "stigmer/stigmer#439",
	apiresourcekind.ApiResourceKind_organization:       "stigmer/stigmer#439",
	apiresourcekind.ApiResourceKind_workflow_execution: "stigmer/stigmer#439",
	apiresourcekind.ApiResourceKind_workflow_instance:  "stigmer/stigmer#439",
	// artifact is annotated search-indexed but NEITHER edition has an
	// extractor for it (nothing indexes artifact writes anywhere) — the
	// annotation itself looks wrong. Flagged on the same audit issue.
	apiresourcekind.ApiResourceKind_artifact: "stigmer/stigmer#439",
}

// TestSearchableKinds_CoverSearchIndexedProtoKinds pins SearchableKinds
// against the proto kind registry's not_search_indexed annotation — the
// platform's declared source of truth for what search serves.
//
// The defect this kills: a kind whose extractor indexes every write while
// the allowlist silently drops every read shipped three separate times
// (environment and project, fixed in cd141a8be; session, stigmer/stigmer#310).
// Nothing cross-checked the two layers, so each gap was invisible until a
// consumer noticed an empty list. This test makes the gap a suite failure:
// declaring a kind search-indexed in the proto now forces an explicit
// read-side decision — an allowlist entry or a cited searchDecisionPending
// row — before the suite goes green.
func TestSearchableKinds_CoverSearchIndexedProtoKinds(t *testing.T) {
	for value := range apiresourcekind.ApiResourceKind_name {
		kind := apiresourcekind.ApiResourceKind(value)
		if kind == apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
			continue
		}

		meta, err := apiresource.GetKindMeta(kind)
		if err != nil {
			t.Errorf("kind %s: reading kind_meta failed: %v", kind, err)
			continue
		}

		issue, pending := searchDecisionPending[kind]

		// The OSS server never serves cloud-only kinds (e.g. identity_account),
		// so they take no read-side decision here.
		if meta.GetTier() == apiresourcekind.ResourceTier_cloud_only {
			if SearchableKinds[kind] {
				t.Errorf("kind %s: tier cloud_only but present in SearchableKinds — the OSS server cannot serve it", kind)
			}
			if pending {
				t.Errorf("kind %s: tier cloud_only needs no OSS read-side decision — remove its searchDecisionPending row", kind)
			}
			continue
		}

		if meta.GetNotSearchIndexed() {
			if SearchableKinds[kind] {
				t.Errorf("kind %s: proto declares not_search_indexed but SearchableKinds allows it — flip the annotation or drop the entry", kind)
			}
			if pending {
				t.Errorf("kind %s: proto already rules it not_search_indexed — remove its searchDecisionPending row", kind)
			}
			continue
		}

		// Search-indexed, OSS-tier kind: the read-side decision must be explicit.
		switch {
		case SearchableKinds[kind] && pending:
			t.Errorf("kind %s: present in SearchableKinds AND searchDecisionPending — the decision landed, remove the pending row", kind)
		case !SearchableKinds[kind] && !pending:
			t.Errorf(
				"kind %s: declared search-indexed (not_search_indexed: false) but absent from both SearchableKinds and searchDecisionPending — "+
					"its writes are indexed while reads silently drop the kind (and a request for it alone degrades to discover mode, stigmer/stigmer#440). "+
					"This is the environment/project/session defect (stigmer/stigmer#310). "+
					"Add it to SearchableKinds or record the pending decision with an issue citation",
				kind,
			)
		case pending && issue == "":
			t.Errorf("kind %s: searchDecisionPending entry has no issue citation", kind)
		}
	}
}
