package agent

import (
	"context"
	"sort"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// This file is the agent-side half of the DD-010 SD-6 no-public-exposure
// guard: an agent with datastore_usages can never be exposed beyond its
// org, because the datastore's grants would then serve callers outside
// the org's control (multi-tenant datastore sharing is unsupported in
// v1). Enforced fail-loud at every configuration surface, in both
// directions — making a datastore-attached agent public, and attaching
// datastores to an already-exposed agent. The agentshare controller
// carries the mirror half (public-audience shares). Channels are
// unaffected: they are not shares, and channel sessions run inside the
// owner org under the datastore's own grants.
//
// Both messages are cross-edition contract text (T04 mirrors
// byte-for-byte).

// AgentDatastoreSlugs returns the sorted, deduplicated datastore slugs
// an agent's datastore_usages reference — the guard messages name them
// so the operator knows exactly what blocks the exposure.
func AgentDatastoreSlugs(agent *agentv1.Agent) []string {
	seen := map[string]bool{}
	var slugs []string
	for _, usage := range agent.GetSpec().GetDatastoreUsages() {
		slug := usage.GetDatastoreRef().GetSlug()
		if slug != "" && !seen[slug] {
			seen[slug] = true
			slugs = append(slugs, slug)
		}
	}
	sort.Strings(slugs)
	return slugs
}

// datastorePublicVisibilityError is the shared refusal for the
// visibility direction (create, update, and updateVisibility all
// converge on the same state conflict: public + datastore_usages).
func datastorePublicVisibilityError(agentSlug string, datastoreSlugs []string) error {
	return grpclib.FailedPreconditionError(
		"agent %q cannot be public while it uses datastores (%s): multi-tenant datastore sharing is not supported — keep the agent private or org-visible, or remove its datastore_usages",
		agentSlug, strings.Join(datastoreSlugs, ", "))
}

// guardDatastoreExposureStep refuses an agent create/update whose
// resulting state exposes datastores beyond the org:
//
//   - visibility public + datastore_usages in one state (either field
//     may be the newcomer — the conflict is the state, not the edit);
//   - datastore_usages added while a public-audience AgentShare
//     references the agent (the reverse direction of the agentshare
//     controller's own audience guard, mirroring the delete-guard
//     pattern of checking the other resource before the operation).
type guardDatastoreExposureStep struct {
	store store.Store
}

func newGuardDatastoreExposureStep(store store.Store) *guardDatastoreExposureStep {
	return &guardDatastoreExposureStep{store: store}
}

func (s *guardDatastoreExposureStep) Name() string {
	return "GuardAgentDatastoreExposure"
}

func (s *guardDatastoreExposureStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	agent := ctx.NewState()

	datastores := AgentDatastoreSlugs(agent)
	if len(datastores) == 0 {
		return nil
	}

	if agent.GetMetadata().GetVisibility() == apiresourcepb.ApiResourceVisibility_visibility_public {
		return datastorePublicVisibilityError(agent.GetMetadata().GetSlug(), datastores)
	}

	shares, err := findPublicAudienceShares(ctx.Context(), s.store, agent)
	if err != nil {
		return err
	}
	if len(shares) > 0 {
		return grpclib.FailedPreconditionError(
			"agent %q uses datastores (%s) and is referenced by public-audience shares (%s): datastores cannot be exposed to anonymous guests — set those shares to org audience first",
			agent.GetMetadata().GetSlug(), strings.Join(datastores, ", "), strings.Join(shares, ", "))
	}
	return nil
}

// findPublicAudienceShares scans agent shares for public-audience
// entries serving this agent. Matching is pin-first (status.agent_id is
// the rebind guard every share carries); a ref match is accepted only
// for a share with no pin, so a stale share pinned to a deleted agent
// that once held this slug can never block the new agent.
func findPublicAudienceShares(ctx context.Context, s store.Store, agent *agentv1.Agent) ([]string, error) {
	resources, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agent shares for datastore exposure guard")
	}

	agentID := agent.GetMetadata().GetId()
	agentOrg := agent.GetMetadata().GetOrg()
	agentSlug := agent.GetMetadata().GetSlug()

	var shares []string
	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			continue
		}
		// Unspecified audience means public (anyone with the link).
		if share.GetSpec().GetAudience() == agentsharev1.AgentShareAudience_agent_share_audience_org {
			continue
		}
		if pin := share.GetStatus().GetAgentId(); pin != "" {
			if pin != agentID {
				continue
			}
		} else {
			ref := share.GetSpec().GetAgentRef()
			refOrg := ref.GetOrg()
			if refOrg == "" {
				refOrg = share.GetMetadata().GetOrg()
			}
			if ref.GetSlug() != agentSlug || refOrg != agentOrg {
				continue
			}
		}
		shares = append(shares, share.GetMetadata().GetSlug())
	}
	sort.Strings(shares)
	return shares, nil
}

// guardDatastoreExposureOnVisibilityStep is the updateVisibility
// pipeline's instance of the same conflict check, running against the
// loaded agent plus the requested visibility before anything persists.
type guardDatastoreExposureOnVisibilityStep struct{}

func (c *AgentController) newGuardDatastoreExposureOnVisibilityStep() *guardDatastoreExposureOnVisibilityStep {
	return &guardDatastoreExposureOnVisibilityStep{}
}

func (s *guardDatastoreExposureOnVisibilityStep) Name() string {
	return "GuardAgentDatastoreExposureOnVisibility"
}

func (s *guardDatastoreExposureOnVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	if ctx.Input().GetVisibility() != apiresourcepb.ApiResourceVisibility_visibility_public {
		return nil
	}
	agent := ctx.Get(updateVisibilityAgentKey).(*agentv1.Agent)
	datastores := AgentDatastoreSlugs(agent)
	if len(datastores) == 0 {
		return nil
	}
	return datastorePublicVisibilityError(agent.GetMetadata().GetSlug(), datastores)
}
