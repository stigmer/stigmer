package defaultinstance

// The workflow twin of the agentinstance defaultinstance test: pins that the
// default instance is named from the workflow's SLUG, never its display name
// (stigmer/stigmer#355), so slug-based fallback lookups
// (workflow-execution self-heal, future delete cascade) can always
// reconstruct it via Slug().

import (
	"testing"

	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

func TestBuildRequestNamesInstanceFromSlugNotName(t *testing.T) {
	workflow := &apiresourcepb.ApiResourceMetadata{
		Id:   "wf_123",
		Name: "Nightly Sync (US)", // slugifies to nightly-sync-us, not the explicit slug
		Slug: "nightly-sync",
		Org:  "acme",
	}

	request := BuildRequest(workflow)

	if got, want := request.GetMetadata().GetName(), "nightly-sync-default"; got != want {
		t.Errorf("instance name derived from the wrong field: got %q, want %q", got, want)
	}
	if got, want := request.GetMetadata().GetName(), Slug(workflow.GetSlug()); got != want {
		t.Errorf("instance name %q must equal the slug-fallback lookup %q", got, want)
	}
	if got, want := request.GetSpec().GetWorkflowId(), "wf_123"; got != want {
		t.Errorf("workflow_id: got %q, want %q", got, want)
	}
	if got, want := request.GetMetadata().GetOrg(), "acme"; got != want {
		t.Errorf("org: got %q, want %q", got, want)
	}
}

func TestBuildRequestStampsReservedLabels(t *testing.T) {
	request := BuildRequest(&apiresourcepb.ApiResourceMetadata{
		Id: "wf_x", Name: "X", Slug: "x", Org: "org-1",
	})

	labels := request.GetMetadata().GetLabels()
	if labels[apiresource.DefaultInstanceLabel] != apiresource.ReservedLabelTrue {
		t.Errorf("missing %s label", apiresource.DefaultInstanceLabel)
	}
	if labels[apiresource.SystemManagedLabel] != apiresource.ReservedLabelTrue {
		t.Errorf("missing %s label", apiresource.SystemManagedLabel)
	}
}
