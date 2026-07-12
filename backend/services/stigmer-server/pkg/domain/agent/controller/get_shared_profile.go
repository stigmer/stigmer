package agent

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
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
//     enable enumeration. This intentionally diverges from the generic
//     LoadByReferenceStep, which treats empty org as "any org".
//   - NOT_FOUND when the agent does not exist OR exists but is not shared.
//     The two cases return byte-identical errors so an unshared agent's
//     URL leaks nothing about the agent's existence.
func (c *AgentController) GetSharedProfile(
	ctx context.Context,
	ref *apiresource.ApiResourceReference,
) (*agentv1.SharedAgentProfile, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

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
// resolves exactly like GetSharedProfile — any enabled share, regardless
// of audience. Implemented for contract parity so clients can use one
// authenticated resolution path against either edition.
func (c *AgentController) GetSharedProfileForMember(
	ctx context.Context,
	ref *apiresource.ApiResourceReference,
) (*agentv1.SharedAgentProfile, error) {
	return c.GetSharedProfile(ctx, ref)
}

const sharedProfileKey = "sharedAgentProfile"

func (c *AgentController) buildGetSharedProfilePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-get-shared-profile").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(&requireOrgInReferenceStep{}).
		AddStep(steps.NewLoadByReferenceStep[*agentv1.Agent](c.store)).
		AddStep(&projectSharedProfileStep{}).
		Build()
}

// requireOrgInReferenceStep rejects references without an org.
//
// The generic LoadByReferenceStep treats an empty org as "match slug across
// all orgs" — acceptable for authenticated lookups, but an enumeration
// hazard on this public endpoint.
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

// projectSharedProfileStep gates on spec.sharing.enabled and projects the
// loaded agent to its trimmed public profile.
type projectSharedProfileStep struct{}

func (s *projectSharedProfileStep) Name() string {
	return "ProjectSharedProfile"
}

func (s *projectSharedProfileStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceReference]) error {
	agent := ctx.Get(steps.TargetResourceKey).(*agentv1.Agent)

	// The sharing gate: an existing-but-unshared agent must be
	// indistinguishable from a nonexistent one, so this error is
	// byte-identical to LoadByReferenceStep's not-found error
	// ("Agent" is the kind name from kind_meta, as GetKindName returns).
	if !agent.GetSpec().GetSharing().GetEnabled() {
		return grpclib.NotFoundError("Agent", ctx.Input().GetSlug())
	}

	metadata := agent.GetMetadata()
	ctx.Set(sharedProfileKey, &agentv1.SharedAgentProfile{
		Org:               metadata.GetOrg(),
		Slug:              metadata.GetSlug(),
		Name:              metadata.GetName(),
		Description:       agent.GetSpec().GetDescription(),
		IconUrl:           agent.GetSpec().GetIconUrl(),
		DefaultInstanceId: agent.GetStatus().GetDefaultInstanceId(),
	})
	return nil
}
