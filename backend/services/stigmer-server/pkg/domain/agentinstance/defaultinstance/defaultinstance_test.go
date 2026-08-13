package defaultinstance

// Pins the naming contract the delete cascade depends on
// (stigmer/stigmer#355): the default instance is named from the agent's
// SLUG, never its display name. The fixture's name deliberately slugifies
// to something other than the explicit slug — the exact case where the old
// name-fed call sites produced an instance the cascade's
// Slug(agent.GetSlug()) fallback could no longer find.

import (
	"testing"

	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

func TestBuildRequestNamesInstanceFromSlugNotName(t *testing.T) {
	agent := &apiresourcepb.ApiResourceMetadata{
		Id:   "agt_123",
		Name: "Support Assistant (EU)", // slugifies to support-assistant-eu, not the explicit slug
		Slug: "support-bot",
		Org:  "acme",
	}

	request := BuildRequest(agent)

	if got, want := request.GetMetadata().GetName(), "support-bot-default"; got != want {
		t.Errorf("instance name derived from the wrong field: got %q, want %q", got, want)
	}
	if got, want := request.GetMetadata().GetName(), Slug(agent.GetSlug()); got != want {
		t.Errorf("instance name %q must equal the cascade's fallback lookup %q", got, want)
	}
	if got, want := request.GetSpec().GetAgentId(), "agt_123"; got != want {
		t.Errorf("agent_id: got %q, want %q", got, want)
	}
	if got, want := request.GetMetadata().GetOrg(), "acme"; got != want {
		t.Errorf("org: got %q, want %q", got, want)
	}
}

func TestBuildRequestStampsReservedLabels(t *testing.T) {
	request := BuildRequest(&apiresourcepb.ApiResourceMetadata{
		Id: "agt_x", Name: "X", Slug: "x", Org: "org-1",
	})

	labels := request.GetMetadata().GetLabels()
	if labels[apiresource.DefaultInstanceLabel] != apiresource.ReservedLabelTrue {
		t.Errorf("missing %s label", apiresource.DefaultInstanceLabel)
	}
	if labels[apiresource.SystemManagedLabel] != apiresource.ReservedLabelTrue {
		t.Errorf("missing %s label", apiresource.SystemManagedLabel)
	}
}
