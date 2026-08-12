package agentshare

import (
	"context"
	"fmt"
	"sort"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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
//  2. Normalizes spec.agent_ref.org (empty means same-org) and loads the
//     referenced agent — creating a channel for a nonexistent agent is
//     refused with the same NOT_FOUND a direct agent lookup would produce.
//  3. For a CROSS-ORG share (ref org differs from the share's org),
//     enforces the decision 013 contract — see validateCrossOrgShare.
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
	// convention); make it absolute before anything compares orgs.
	if agentRef.GetOrg() == "" {
		agentRef.Org = metadata.GetOrg()
	}

	agent, found, err := findAgentByOrgAndSlug(ctx.Context(), s.store, agentRef.GetOrg(), agentRef.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		return grpclib.NotFoundError("Agent", agentRef.GetSlug())
	}

	if agentRef.GetOrg() != metadata.GetOrg() {
		if err := validateCrossOrgShare(ctx.Context(), s.store, share, agent); err != nil {
			return err
		}
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

// validateCrossOrgShare enforces the cross-org share contract
// (decision 013) when a share references an agent in another organization:
//
//   - The agent must be marketplace-public — public visibility IS the
//     origin org's consent to external shares (D1). A non-public agent is
//     refused with the same NOT_FOUND as a missing one: for the sharing
//     org, another org's private agent does not exist, and this create
//     path must not become an existence probe for private slugs.
//   - The audience must be public (D3). Org-audience semantics don't
//     carry across the org boundary (the member gate is scoped to the
//     agent's own org); refusing loudly beats a share that silently admits
//     nobody.
//   - Every dependency the agent declares must itself be public (D5) —
//     skills (including sub-agents') and MCP servers resolve for guests
//     only when public, so a non-public dependency would create a channel
//     whose agent silently loses its tools. The refusal names every
//     blocker so the sharing org knows exactly what to ask the agent's
//     org to publish. The blockers are already disclosed by the public
//     agent's spec (the refs are readable); only their visibility status
//     is being reported.
//
// Runtime re-enforcement (per-turn visibility re-checks, the runner's
// public-only dependency reads) is cloud-side — this create-time sweep is
// the fail-loud half of the contract, mirrored in both editions.
func validateCrossOrgShare(
	ctx context.Context,
	s store.Store,
	share *agentsharev1.AgentShare,
	agent *agentv1.Agent,
) error {
	agentMeta := agent.GetMetadata()

	if agentMeta.GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		return grpclib.NotFoundError("Agent", agentMeta.GetSlug())
	}

	if share.GetSpec().GetAudience() == agentsharev1.AgentShareAudience_agent_share_audience_org {
		return grpclib.FailedPreconditionError(
			"a cross-org share must have a public audience — org-audience shares are limited to the agent's own organization (%s)",
			agentMeta.GetOrg(),
		)
	}

	blockers, err := findNonPublicDependencies(ctx, s, agent)
	if err != nil {
		return err
	}
	if len(blockers) > 0 {
		return grpclib.FailedPreconditionError(
			"cannot share %s/%s across organizations: it references resources that are not public: %s",
			agentMeta.GetOrg(), agentMeta.GetSlug(), strings.Join(blockers, ", "),
		)
	}

	return nil
}

// findNonPublicDependencies sweeps the agent's declared blueprint
// dependencies — skill_refs (including every sub-agent's) and
// mcp_server_usages — and returns a deterministic "kind org/slug" entry
// for each that is missing or not visibility_public. A reference with an
// empty org is relative to the AGENT's org (references are normalized to
// absolute form at agent write time; the fallback covers defensive
// parity with the cloud edition's referenceMatches).
func findNonPublicDependencies(
	ctx context.Context,
	s store.Store,
	agent *agentv1.Agent,
) ([]string, error) {
	spec := agent.GetSpec()
	agentOrg := agent.GetMetadata().GetOrg()

	type depRef struct {
		kind apiresourcekind.ApiResourceKind
		org  string
		slug string
	}

	seen := map[depRef]bool{}
	var deps []depRef
	add := func(kind apiresourcekind.ApiResourceKind, ref *apiresource.ApiResourceReference) {
		if ref.GetSlug() == "" {
			return
		}
		org := ref.GetOrg()
		if org == "" {
			org = agentOrg
		}
		d := depRef{kind: kind, org: org, slug: ref.GetSlug()}
		if !seen[d] {
			seen[d] = true
			deps = append(deps, d)
		}
	}

	for _, ref := range spec.GetSkillRefs() {
		add(apiresourcekind.ApiResourceKind_skill, ref)
	}
	for _, sub := range spec.GetSubAgents() {
		for _, ref := range sub.GetSkillRefs() {
			add(apiresourcekind.ApiResourceKind_skill, ref)
		}
	}
	for _, usage := range spec.GetMcpServerUsages() {
		add(apiresourcekind.ApiResourceKind_mcp_server, usage.GetMcpServerRef())
	}

	var blockers []string
	for _, d := range deps {
		var visibility apiresource.ApiResourceVisibility
		var found bool
		var err error

		switch d.kind {
		case apiresourcekind.ApiResourceKind_skill:
			var skill *skillv1.Skill
			skill, found, err = steps.FindResourceBySlug[*skillv1.Skill](ctx, s, d.kind, d.slug, d.org)
			visibility = skill.GetMetadata().GetVisibility()
		case apiresourcekind.ApiResourceKind_mcp_server:
			var server *mcpserverv1.McpServer
			server, found, err = steps.FindResourceBySlug[*mcpserverv1.McpServer](ctx, s, d.kind, d.slug, d.org)
			visibility = server.GetMetadata().GetVisibility()
		}
		if err != nil {
			return nil, grpclib.InternalError(err, fmt.Sprintf(
				"failed to resolve %s %s/%s while validating cross-org share",
				d.kind.String(), d.org, d.slug))
		}
		if !found || visibility != apiresource.ApiResourceVisibility_visibility_public {
			blockers = append(blockers, fmt.Sprintf("%s %s/%s", d.kind.String(), d.org, d.slug))
		}
	}

	sort.Strings(blockers)
	return blockers, nil
}

// stampAgentPinStep writes status.agent_id — the server-owned rebind pin
// (decision 013): the immutable ID of the agent that spec.agent_ref
// resolved to at creation. agent_ref is org+slug and slugs are reusable
// after delete, so without the pin a stale share would silently attach its
// audience, link token, and bound credentials to whatever agent later
// claims the slug. Every share-resolution gate verifies the pin when
// present.
//
// Runs AFTER BuildNewState, which clears client-provided status — the pin
// is system-managed and must survive that wipe, exactly like the audit
// fields. Reads the agent ResolveShareDefaults already loaded.
type stampAgentPinStep struct{}

func (s *stampAgentPinStep) Name() string {
	return "StampAgentPin"
}

func (s *stampAgentPinStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.AgentShare]) error {
	agentVal := ctx.Get(referencedAgentKey)
	if agentVal == nil {
		return grpclib.InternalError(nil, "referenced agent not found in context (ResolveShareDefaults must run first)")
	}
	agent := agentVal.(*agentv1.Agent)

	share := ctx.NewState()
	if share.GetStatus() == nil {
		share.Status = &agentsharev1.AgentShareStatus{}
	}
	share.Status.AgentId = agent.GetMetadata().GetId()
	return nil
}

// validateShareUpdateStep enforces the share's immutable identity on
// update: spec.agent_ref must keep referencing the same agent. A share is
// a channel FOR one agent — re-pointing it would silently move guest
// traffic (and its billing) to a different blueprint; create a new share
// instead. Runs after LoadExisting so the existing state is available.
//
// metadata.slug/org immutability needs no step here: the generic
// BuildUpdateState preserves both from the existing resource. Status
// (including the agent-id pin) is likewise preserved wholesale.
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

	// The cross-org public-audience rule (decision 013 D3) must hold on
	// update too — create validates it, but update replaces the spec
	// wholesale and must not open a side door to an org-audience cross-org
	// share.
	isCrossOrg := existingRef.GetOrg() != existing.GetMetadata().GetOrg()
	if isCrossOrg && ctx.Input().GetSpec().GetAudience() ==
		agentsharev1.AgentShareAudience_agent_share_audience_org {
		return grpclib.FailedPreconditionError(
			"a cross-org share must have a public audience — org-audience shares are limited to the agent's own organization (%s)",
			existingRef.GetOrg(),
		)
	}

	return nil
}
