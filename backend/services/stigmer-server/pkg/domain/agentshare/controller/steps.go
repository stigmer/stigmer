package agentshare

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// referencedAgentKey holds the agent resolved from spec.agent_ref during
// create/apply, so later steps never re-load it.
const referencedAgentKey = "agentShareReferencedAgent"

// findAgentByOrgAndSlug scans agents for an org+slug match. Full-scan
// lookup matches the store's local/OSS posture (see LoadByReferenceStep);
// the cloud edition uses an indexed repository query instead.
func findAgentByOrgAndSlug(
	ctx context.Context,
	s store.Store,
	org string,
	slug string,
) (*agentv1.Agent, bool, error) {
	resources, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list agent resources")
	}

	for _, data := range resources {
		agent := &agentv1.Agent{}
		if err := proto.Unmarshal(data, agent); err != nil {
			// Skip invalid entries (should not happen in normal operation).
			continue
		}
		metadata := agent.GetMetadata()
		if metadata.GetSlug() == slug && metadata.GetOrg() == org {
			return agent, true, nil
		}
	}

	return nil, false, nil
}

// resolveShareDefaultsStep prepares a share for creation:
//
//  1. Requires metadata.org — the share's org appears in the hosted chat
//     URL and is the billing org, so it can never be inferred.
//  2. Normalizes spec.agent_ref.org (empty means same-org) and enforces
//     the Phase A invariant: the share's org must equal the referenced
//     agent's org. Cross-org shares are Phase B (decision 012).
//  3. Loads the referenced agent — creating a channel for a nonexistent
//     agent is refused with the same NOT_FOUND a direct agent lookup
//     would produce.
//  4. Defaults metadata.slug (and a display name) from the referenced
//     agent when the caller provided neither, so the canonical share keeps
//     the agent's hosted URL (`/chat/<org>/<agent-slug>` — decision 011
//     D2). Runs before ResolveSlug, which skips resources whose slug is
//     already set.
type resolveShareDefaultsStep struct {
	store store.Store
}

func (s *resolveShareDefaultsStep) Name() string {
	return "ResolveShareDefaults"
}

func (s *resolveShareDefaultsStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.AgentShare]) error {
	share := ctx.NewState()
	metadata := share.GetMetadata()

	if metadata.GetOrg() == "" {
		return grpclib.InvalidArgumentError("metadata.org is required for an agent share")
	}

	agentRef := share.GetSpec().GetAgentRef()
	if agentRef.GetSlug() == "" {
		return grpclib.InvalidArgumentError("spec.agent_ref.slug is required")
	}

	// Empty ref org means same-org (the platform-wide relative-reference
	// convention); make it absolute before the invariant check.
	if agentRef.GetOrg() == "" {
		agentRef.Org = metadata.GetOrg()
	}
	if agentRef.GetOrg() != metadata.GetOrg() {
		return grpclib.FailedPreconditionError(
			"a share must live in the referenced agent's organization (share org %q, agent org %q) — cross-org shares are not supported yet",
			metadata.GetOrg(), agentRef.GetOrg(),
		)
	}

	agent, found, err := findAgentByOrgAndSlug(ctx.Context(), s.store, agentRef.GetOrg(), agentRef.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		return grpclib.NotFoundError("Agent", agentRef.GetSlug())
	}
	ctx.Set(referencedAgentKey, agent)

	// Canonical-share default: no slug and no name means "share this agent
	// under its own slug". A caller-provided name still flows through
	// ResolveSlug for a deliberately distinct link.
	if metadata.GetSlug() == "" && metadata.GetName() == "" {
		metadata.Slug = agent.GetMetadata().GetSlug()
		metadata.Name = agent.GetMetadata().GetName()
	}

	return nil
}

// validateShareUpdateStep enforces the share's immutable identity on
// update: spec.agent_ref must keep referencing the same agent. A share is
// a channel FOR one agent — re-pointing it would silently move guest
// traffic (and its billing) to a different blueprint; create a new share
// instead. Runs after LoadExisting so the existing state is available.
//
// metadata.slug/org immutability needs no step here: the generic
// BuildUpdateState preserves both from the existing resource.
type validateShareUpdateStep struct{}

func (s *validateShareUpdateStep) Name() string {
	return "ValidateShareUpdate"
}

func (s *validateShareUpdateStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.AgentShare]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing agent share not found in context")
	}
	existing := existingVal.(*agentsharev1.AgentShare)

	inputRef := ctx.Input().GetSpec().GetAgentRef()
	existingRef := existing.GetSpec().GetAgentRef()

	// Normalize the input ref's org the same way create does (empty means
	// the share's own org) before comparing.
	inputOrg := inputRef.GetOrg()
	if inputOrg == "" {
		inputOrg = existing.GetMetadata().GetOrg()
	}

	if inputRef.GetSlug() != existingRef.GetSlug() || inputOrg != existingRef.GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.agent_ref is immutable (share references %s/%s) — create a new share to distribute a different agent",
			existingRef.GetOrg(), existingRef.GetSlug(),
		)
	}

	return nil
}
