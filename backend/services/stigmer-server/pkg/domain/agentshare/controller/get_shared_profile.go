package agentshare

import (
	"context"
	"crypto/subtle"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// GetSharedProfile resolves a share's public profile by org/slug.
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
//   - NOT_FOUND when the share does not exist, exists but is disabled,
//     OR the share link is locked (status.share_link_token set) and the
//     presented link_token does not match. All cases return byte-identical
//     errors so an unshared or rotated-away URL leaks nothing.
func (c *AgentShareController) GetSharedProfile(
	ctx context.Context,
	req *agentsharev1.GetSharedProfileRequest,
) (*agentsharev1.SharedAgentProfile, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetSharedProfilePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	profile := reqCtx.Get(sharedProfileKey).(*agentsharev1.SharedAgentProfile)
	return profile, nil
}

// GetSharedProfileForMember resolves a share's profile for an
// authenticated organization member.
//
// In the cloud edition this RPC is the resolution path for org-audience
// shares (spec.audience = org), gated by a live org-membership check. The
// OSS edition is single-user and local: the one principal is effectively
// the organization, so membership always holds and this resolves any
// enabled share regardless of audience. Implemented for contract parity
// so clients can use one authenticated resolution path against either
// edition.
//
// One deliberate exception, mirrored from the cloud edition: a
// public-audience share whose link is locked (status.share_link_token
// set) refuses with NOT_FOUND. This tokenless path must not reveal a
// killed (rotated) link's profile — such shares resolve only through
// GetSharedProfile with the matching token.
func (c *AgentShareController) GetSharedProfileForMember(
	ctx context.Context,
	ref *apiresource.ApiResourceReference,
) (*agentsharev1.SharedAgentProfile, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetSharedProfileForMemberPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	profile := reqCtx.Get(sharedProfileKey).(*agentsharev1.SharedAgentProfile)
	return profile, nil
}

const (
	sharedProfileKey = "sharedAgentProfile"
	resolvedShareKey = "resolvedAgentShare"
)

func (c *AgentShareController) buildGetSharedProfilePipeline() *pipeline.Pipeline[*agentsharev1.GetSharedProfileRequest] {
	return pipeline.NewPipeline[*agentsharev1.GetSharedProfileRequest]("agent-share-get-shared-profile").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.GetSharedProfileRequest]()).
		AddStep(&loadShareForProfileStep{store: c.store}).
		AddStep(&projectSharedProfileStep{store: c.store}).
		Build()
}

func (c *AgentShareController) buildGetSharedProfileForMemberPipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-share-get-shared-profile-for-member").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(&loadShareForMemberProfileStep{store: c.store}).
		AddStep(&projectMemberSharedProfileStep{store: c.store}).
		Build()
}

// sharedNotFound is the single refusal for every anonymous/member
// resolution miss: share missing, share disabled, dangling agent_ref,
// wrong or absent link token. The message deliberately says "Agent" — the
// visitor asked for an agent's chat page, and the share resource is an
// internal modeling detail that a public error must not teach. One
// constructor guarantees the byte-identical-errors contract by
// construction.
func sharedNotFound(slug string) error {
	return grpclib.NotFoundError("Agent", slug)
}

// sharingLinkTokenAllowed is the link-token predicate — the Go mirror of the
// cloud edition's SharingLinkTokenPolicy, with identical semantics:
//
//   - No live token (empty status.share_link_token): allowed. The share
//     link is the plain /chat/<org>/<slug>; whatever the caller presented
//     is ignored, so a stale ?k= on an unlocked link stays harmless.
//   - Live token set: the presented token must match exactly. A missing or
//     rotated-away token refuses, surfacing as the same NOT_FOUND as a
//     nonexistent share — never a distinct "wrong token" error.
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

// findShareByOrgAndSlug scans shares for an org+slug match. Full-scan
// lookup matches the store's local/OSS posture; the cloud edition uses an
// indexed repository query instead.
func findShareByOrgAndSlug(
	ctx context.Context,
	s store.Store,
	org string,
	slug string,
) (*agentsharev1.AgentShare, bool, error) {
	resources, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list agent share resources")
	}

	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			// Skip invalid entries (should not happen in normal operation).
			continue
		}
		metadata := share.GetMetadata()
		if metadata.GetSlug() == slug && metadata.GetOrg() == org {
			return share, true, nil
		}
	}

	return nil, false, nil
}

// loadShareForProfileStep loads the share by org+slug for the anonymous
// resolution path.
//
// Org is required: an empty org would mean "match slug across all orgs" —
// an enumeration hazard on this public endpoint.
type loadShareForProfileStep struct {
	store store.Store
}

func (s *loadShareForProfileStep) Name() string {
	return "LoadShareForProfile"
}

func (s *loadShareForProfileStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.GetSharedProfileRequest]) error {
	req := ctx.Input()

	if req.GetOrg() == "" {
		return grpclib.InvalidArgumentError("org is required for shared agent lookup")
	}

	share, found, err := findShareByOrgAndSlug(ctx.Context(), s.store, req.GetOrg(), req.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		return sharedNotFound(req.GetSlug())
	}

	ctx.Set(resolvedShareKey, share)
	return nil
}

// loadShareForMemberProfileStep loads the share by org+slug for the
// authenticated member path — same org-required contract and the same
// refusal as the anonymous path.
type loadShareForMemberProfileStep struct {
	store store.Store
}

func (s *loadShareForMemberProfileStep) Name() string {
	return "LoadShareForMemberProfile"
}

func (s *loadShareForMemberProfileStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceReference]) error {
	ref := ctx.Input()

	if ref.GetOrg() == "" {
		return grpclib.InvalidArgumentError("org is required for shared agent lookup")
	}

	share, found, err := findShareByOrgAndSlug(ctx.Context(), s.store, ref.GetOrg(), ref.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		return sharedNotFound(ref.GetSlug())
	}

	ctx.Set(resolvedShareKey, share)
	return nil
}

// projectSharedProfileStep gates on spec.enabled plus the live link token,
// then projects the share and its referenced agent to the trimmed public
// profile.
type projectSharedProfileStep struct {
	store store.Store
}

func (s *projectSharedProfileStep) Name() string {
	return "ProjectSharedProfile"
}

func (s *projectSharedProfileStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.GetSharedProfileRequest]) error {
	share := ctx.Get(resolvedShareKey).(*agentsharev1.AgentShare)
	req := ctx.Input()

	// The sharing gate: an existing-but-disabled share must be
	// indistinguishable from a nonexistent one.
	if !share.GetSpec().GetEnabled() {
		return sharedNotFound(req.GetSlug())
	}

	// The link-token gate: a locked link with a wrong or absent token is
	// equally indistinguishable — a rotated (killed) link must look exactly
	// like a link that never existed.
	if !sharingLinkTokenAllowed(req.GetLinkToken(), share.GetStatus().GetShareLinkToken()) {
		return sharedNotFound(req.GetSlug())
	}

	profile, err := buildSharedAgentProfile(ctx.Context(), s.store, share)
	if err != nil {
		return err
	}
	ctx.Set(sharedProfileKey, profile)
	return nil
}

// projectMemberSharedProfileStep is the member path's projection: gates on
// spec.enabled and refuses token-locked public-audience shares (see
// GetSharedProfileForMember), then projects the trimmed profile.
type projectMemberSharedProfileStep struct {
	store store.Store
}

func (s *projectMemberSharedProfileStep) Name() string {
	return "ProjectMemberSharedProfile"
}

func (s *projectMemberSharedProfileStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceReference]) error {
	share := ctx.Get(resolvedShareKey).(*agentsharev1.AgentShare)

	if !share.GetSpec().GetEnabled() {
		return sharedNotFound(ctx.Input().GetSlug())
	}

	// A public share locked with a link token resolves ONLY through the
	// tokened anonymous path: admitting it here would reveal a killed
	// (rotated) link's profile through this tokenless RPC. Org-audience
	// shares are unaffected — their gate is membership, not the link token.
	isOrgAudience := share.GetSpec().GetAudience() ==
		agentsharev1.AgentShareAudience_agent_share_audience_org
	if !isOrgAudience && share.GetStatus().GetShareLinkToken() != "" {
		return sharedNotFound(ctx.Input().GetSlug())
	}

	profile, err := buildSharedAgentProfile(ctx.Context(), s.store, share)
	if err != nil {
		return err
	}
	ctx.Set(sharedProfileKey, profile)
	return nil
}

// buildSharedAgentProfile projects a share and its referenced agent to the
// trimmed public profile — the single projection shared by the anonymous
// and member paths.
//
// The URL identity (org, slug) comes from the SHARE; the display fields
// and default_instance_id come from the referenced AGENT. Three misses all
// fail closed with the standard refusal, indistinguishable from absence:
//
//   - A dangling agent_ref (agent deleted after the share was created) —
//     a channel to a missing agent must look exactly like no channel.
//   - A stale agent-id pin (status.agent_id set but a DIFFERENT agent now
//     lives at the referenced org/slug) — the rebind guard (decision 013):
//     the share's audience, link token, and credentials were consented for
//     the original agent, never its slug's successor. Checked only when
//     present; pre-pin legacy shares are covered by the same-org delete
//     cascade instead.
//   - A cross-org agent that is no longer visibility_public — public
//     visibility is the origin org's consent to external shares, and
//     withdrawing it must kill every external channel (decision 013).
func buildSharedAgentProfile(
	ctx context.Context,
	s store.Store,
	share *agentsharev1.AgentShare,
) (*agentsharev1.SharedAgentProfile, error) {
	ref := share.GetSpec().GetAgentRef()
	agent, found, err := findAgentByOrgAndSlug(ctx, s, ref.GetOrg(), ref.GetSlug())
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, sharedNotFound(share.GetMetadata().GetSlug())
	}

	if pin := share.GetStatus().GetAgentId(); pin != "" && pin != agent.GetMetadata().GetId() {
		return nil, sharedNotFound(share.GetMetadata().GetSlug())
	}

	isCrossOrg := share.GetMetadata().GetOrg() != agent.GetMetadata().GetOrg()
	if isCrossOrg && agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		return nil, sharedNotFound(share.GetMetadata().GetSlug())
	}

	return &agentsharev1.SharedAgentProfile{
		Org:               share.GetMetadata().GetOrg(),
		Slug:              share.GetMetadata().GetSlug(),
		Name:              agent.GetMetadata().GetName(),
		Description:       agent.GetSpec().GetDescription(),
		IconUrl:           agent.GetSpec().GetIconUrl(),
		DefaultInstanceId: agent.GetStatus().GetDefaultInstanceId(),
	}, nil
}
