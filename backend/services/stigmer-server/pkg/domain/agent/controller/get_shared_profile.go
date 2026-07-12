package agent

import (
	"context"
	"crypto/subtle"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// GetSharedProfile resolves a shared agent's public profile by org/slug.
//
// This is the resolution path for the hosted chat page: anonymous visitors
// resolve a shared link to the trimmed SharedAgentProfile — never the full
// Agent, whose spec carries the system prompt, environment declarations,
// and MCP wiring.
//
// Error contract (see query.proto):
//   - INVALID_ARGUMENT when org is empty — org+slug is the shared URL's
//     identity, and cross-org slug matching on a public endpoint would
//     enable enumeration.
//   - NOT_FOUND when the agent does not exist, exists but is not shared,
//     OR the share link is locked (status.share_link_token set) and the
//     presented link_token does not match. All cases return byte-identical
//     errors so an unshared or rotated-away URL leaks nothing about the
//     agent's existence.
func (c *AgentController) GetSharedProfile(
	ctx context.Context,
	req *agentv1.GetSharedProfileRequest,
) (*agentv1.SharedAgentProfile, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetSharedProfilePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	profile := reqCtx.Get(sharedProfileKey).(*agentv1.SharedAgentProfile)
	return profile, nil
}

// GetSharedProfileForMember resolves a shared agent's profile for an
// authenticated organization member.
//
// In the cloud edition this RPC is the resolution path for org-audience
// shares (spec.sharing.audience = org), gated by a live org-membership
// check. The OSS edition is single-user and local: the one principal is
// effectively the organization, so membership always holds and this
// resolves any enabled share regardless of audience. Implemented for
// contract parity so clients can use one authenticated resolution path
// against either edition.
//
// One deliberate exception, mirrored from the cloud edition: a
// public-audience share whose link is locked (status.share_link_token
// set) refuses with NOT_FOUND. This tokenless path must not reveal a
// killed (rotated) link's profile — such shares resolve only through
// GetSharedProfile with the matching token.
func (c *AgentController) GetSharedProfileForMember(
	ctx context.Context,
	ref *apiresource.ApiResourceReference,
) (*agentv1.SharedAgentProfile, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetSharedProfileForMemberPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	profile := reqCtx.Get(sharedProfileKey).(*agentv1.SharedAgentProfile)
	return profile, nil
}

const sharedProfileKey = "sharedAgentProfile"

func (c *AgentController) buildGetSharedProfilePipeline() *pipeline.Pipeline[*agentv1.GetSharedProfileRequest] {
	return pipeline.NewPipeline[*agentv1.GetSharedProfileRequest]("agent-get-shared-profile").
		AddStep(steps.NewValidateProtoStep[*agentv1.GetSharedProfileRequest]()).
		AddStep(&loadSharedAgentStep{store: c.store}).
		AddStep(&projectSharedProfileStep{}).
		Build()
}

func (c *AgentController) buildGetSharedProfileForMemberPipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-get-shared-profile-for-member").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(&requireOrgInReferenceStep{}).
		AddStep(steps.NewLoadByReferenceStep[*agentv1.Agent](c.store)).
		AddStep(&projectMemberSharedProfileStep{}).
		Build()
}

// sharingLinkTokenAllowed is the link-token predicate — the Go mirror of the
// cloud edition's SharingLinkTokenPolicy, with identical semantics:
//
//   - No live token (empty status.share_link_token): allowed. The share
//     link is the plain /chat/<org>/<slug>; whatever the caller presented
//     is ignored, so a stale ?k= on an unlocked link stays harmless.
//   - Live token set: the presented token must match exactly. A missing or
//     rotated-away token refuses, surfacing as the same NOT_FOUND as a
//     nonexistent agent — never a distinct "wrong token" error.
//
// Comparison is constant-time. The token is a rotatable traffic lever, not
// a hard credential, but constant-time equality costs one line and removes
// the timing side channel entirely.
func sharingLinkTokenAllowed(presented, live string) bool {
	if live == "" {
		return true
	}
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(live)) == 1
}

// loadSharedAgentStep loads the agent by org+slug for the anonymous
// resolution path.
//
// Org is required: the generic LoadByReferenceStep treats an empty org as
// "match slug across all orgs" — acceptable for authenticated lookups, but
// an enumeration hazard on this public endpoint. The not-found error is
// byte-identical to LoadByReferenceStep's so the two load paths stay
// indistinguishable to callers.
type loadSharedAgentStep struct {
	store store.Store
}

func (s *loadSharedAgentStep) Name() string {
	return "LoadSharedAgent"
}

func (s *loadSharedAgentStep) Execute(ctx *pipeline.RequestContext[*agentv1.GetSharedProfileRequest]) error {
	req := ctx.Input()

	if req.GetOrg() == "" {
		return grpclib.InvalidArgumentError("org is required for shared agent lookup")
	}

	agent, found, err := findAgentByOrgAndSlug(ctx.Context(), s.store, req.GetOrg(), req.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		// "Agent" is the kind name from kind_meta, matching what
		// LoadByReferenceStep returns for the same miss.
		return grpclib.NotFoundError("Agent", req.GetSlug())
	}

	ctx.Set(steps.TargetResourceKey, agent)
	return nil
}

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

// requireOrgInReferenceStep rejects references without an org — the member
// path keeps the same org-required contract as the anonymous path.
type requireOrgInReferenceStep struct{}

func (s *requireOrgInReferenceStep) Name() string {
	return "RequireOrgInReference"
}

func (s *requireOrgInReferenceStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceReference]) error {
	if ctx.Input().GetOrg() == "" {
		return grpclib.InvalidArgumentError("org is required for shared agent lookup")
	}
	return nil
}

// projectSharedProfileStep gates on spec.sharing.enabled plus the live
// share-link token, then projects the loaded agent to its trimmed public
// profile.
type projectSharedProfileStep struct{}

func (s *projectSharedProfileStep) Name() string {
	return "ProjectSharedProfile"
}

func (s *projectSharedProfileStep) Execute(ctx *pipeline.RequestContext[*agentv1.GetSharedProfileRequest]) error {
	agent := ctx.Get(steps.TargetResourceKey).(*agentv1.Agent)
	req := ctx.Input()

	// The sharing gate: an existing-but-unshared agent must be
	// indistinguishable from a nonexistent one, so this error is
	// byte-identical to the load step's not-found error.
	if !agent.GetSpec().GetSharing().GetEnabled() {
		return grpclib.NotFoundError("Agent", req.GetSlug())
	}

	// The link-token gate: a locked link with a wrong or absent token is
	// equally indistinguishable — a rotated (killed) link must look exactly
	// like a link that never existed.
	if !sharingLinkTokenAllowed(req.GetLinkToken(), agent.GetStatus().GetShareLinkToken()) {
		return grpclib.NotFoundError("Agent", req.GetSlug())
	}

	ctx.Set(sharedProfileKey, buildSharedAgentProfile(agent))
	return nil
}

// projectMemberSharedProfileStep is the member path's projection: gates on
// spec.sharing.enabled and refuses token-locked public-audience shares
// (see GetSharedProfileForMember), then projects the trimmed profile.
type projectMemberSharedProfileStep struct{}

func (s *projectMemberSharedProfileStep) Name() string {
	return "ProjectMemberSharedProfile"
}

func (s *projectMemberSharedProfileStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceReference]) error {
	agent := ctx.Get(steps.TargetResourceKey).(*agentv1.Agent)

	if !agent.GetSpec().GetSharing().GetEnabled() {
		return grpclib.NotFoundError("Agent", ctx.Input().GetSlug())
	}

	// A public share locked with a link token resolves ONLY through the
	// tokened anonymous path: admitting it here would reveal a killed
	// (rotated) link's profile through this tokenless RPC. Org-audience
	// shares are unaffected — their gate is membership, not the link token.
	isOrgAudience := agent.GetSpec().GetSharing().GetAudience() ==
		agentv1.AgentSharingAudience_agent_sharing_audience_org
	if !isOrgAudience && agent.GetStatus().GetShareLinkToken() != "" {
		return grpclib.NotFoundError("Agent", ctx.Input().GetSlug())
	}

	ctx.Set(sharedProfileKey, buildSharedAgentProfile(agent))
	return nil
}

// buildSharedAgentProfile projects an agent to the trimmed public profile —
// the single projection shared by the anonymous and member paths.
func buildSharedAgentProfile(agent *agentv1.Agent) *agentv1.SharedAgentProfile {
	metadata := agent.GetMetadata()
	return &agentv1.SharedAgentProfile{
		Org:               metadata.GetOrg(),
		Slug:              metadata.GetSlug(),
		Name:              metadata.GetName(),
		Description:       agent.GetSpec().GetDescription(),
		IconUrl:           agent.GetSpec().GetIconUrl(),
		DefaultInstanceId: agent.GetStatus().GetDefaultInstanceId(),
	}
}
