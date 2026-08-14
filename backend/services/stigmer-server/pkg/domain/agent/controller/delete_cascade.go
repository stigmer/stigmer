package agent

import (
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Agent deletion cascades to the agent's children before the agent row
// itself is removed (children before parent, so a mid-failure retry
// converges — the same ordering the cloud edition's SessionDeleteHandler
// cascade established):
//
//   - ALL of the agent's instances — the system-managed default AND
//     members' personal ones. An earlier posture spared personal instances
//     as "inert dangling references"; that holds for the dangling
//     REFERENCE (spec.agent_id is an immutable ID, never reused) but not
//     for the dangling SLUG: AgentInstance slugs are org-scoped, and the
//     parent agent's detail page is the only instance-management surface —
//     so an orphan occupies its slug org-wide forever with no UI left to
//     delete it. Instances are configuration OF the agent, meaningless
//     without it; owner ruling on stigmer/stigmer#611 extends the workflow
//     ruling (stigmer/stigmer#592): they go with it.
//
//   - The agent's SAME-ORG AgentShares. Shares reference the agent by
//     org+slug (spec.agent_ref), so a stale share would silently rebind —
//     audience, link token, and bound credentials included — to whatever
//     agent is later created at that slug. Cross-org shares (another org
//     sharing this marketplace-public agent, decision 013) are NOT
//     cascaded: they are that org's resources, and deleting them here
//     would make agent delete a cross-principal destructive action. They
//     fail closed instead — via the dangling-ref check and the
//     status.agent_id pin every share-resolution gate verifies.
//
// What deliberately SURVIVES an agent delete, and must never be swept into
// this cascade:
//
//   - Sessions and AgentExecutions — historical record, the #582 posture.
//     They reference the agent and instance by immutable IDs and remain
//     viewable after the agent (and now its instances) are gone.
//   - Version/audit rows (resource_audit) — surviving sessions and
//     executions render their historical state from them.
//
// Both editions implement this contract; the cloud edition additionally
// cleans up each child's FGA tuples (no IAM system in OSS).

// cascadeDeleteInstancesStep deletes every instance of the agent
// (row + search-index entry) before the agent is deleted.
//
// Instances are matched by spec.agent_id — a required, validated field on
// every instance — so a single ID sweep covers the default instance too,
// including legacy rows that predate the status.default_instance_id
// pointer; no pointer-or-slug resolution is needed.
type cascadeDeleteInstancesStep struct {
	store store.Store
}

func newCascadeDeleteInstancesStep(s store.Store) *cascadeDeleteInstancesStep {
	return &cascadeDeleteInstancesStep{store: s}
}

func (s *cascadeDeleteInstancesStep) Name() string {
	return "CascadeDeleteInstances"
}

func (s *cascadeDeleteInstancesStep) Execute(ctx *pipeline.RequestContext[*agentv1.AgentId]) error {
	agent, ok := ctx.Get(steps.ExistingResourceKey).(*agentv1.Agent)
	if !ok {
		return grpclib.InternalError(nil, "agent not found in context (LoadExistingForDelete must run first)")
	}
	agentID := agent.GetMetadata().GetId()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent instances for cascade delete")
	}

	deleted := 0
	for _, data := range resources {
		instance := &agentinstancev1.AgentInstance{}
		if err := proto.Unmarshal(data, instance); err != nil {
			continue
		}
		if instance.GetSpec().GetAgentId() != agentID {
			continue
		}
		instanceID := instance.GetMetadata().GetId()
		if err := s.store.DeleteResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instanceID); err != nil {
			return grpclib.InternalError(err, fmt.Sprintf(
				"failed to cascade-delete instance %s of agent %s", instanceID, agentID))
		}

		// Best-effort, matching DeleteSearchIndexStep: a stale index entry is
		// a cosmetic search artifact, not a correctness problem.
		if err := s.store.DeleteSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instanceID); err != nil {
			log.Warn().Err(err).
				Str("instance_id", instanceID).
				Msg("CascadeDeleteInstances: failed to remove search index entry (best-effort)")
		}
		deleted++
	}

	if deleted > 0 {
		log.Info().
			Int("count", deleted).
			Str("agent_id", agentID).
			Msg("Cascade-deleted instances of agent")
	}
	return nil
}

// cascadeDeleteSharesStep deletes the agent's same-org AgentShares before
// the agent is deleted.
//
// Shares are matched by spec.agent_ref (org + the AGENT's slug), which
// finds them all regardless of each share's own slug — a renamed share
// stays covered (decision 011, D2) — and scoped to shares living in the
// agent's own org: another org's share of this agent is that org's
// resource to delete, and it fails closed on its own (see the package
// comment above). AgentShare is not search-indexed, so there is no index
// entry to clean.
type cascadeDeleteSharesStep struct {
	store store.Store
}

func newCascadeDeleteSharesStep(s store.Store) *cascadeDeleteSharesStep {
	return &cascadeDeleteSharesStep{store: s}
}

func (s *cascadeDeleteSharesStep) Name() string {
	return "CascadeDeleteShares"
}

func (s *cascadeDeleteSharesStep) Execute(ctx *pipeline.RequestContext[*agentv1.AgentId]) error {
	agent, ok := ctx.Get(steps.ExistingResourceKey).(*agentv1.Agent)
	if !ok {
		return grpclib.InternalError(nil, "agent not found in context (LoadExistingForDelete must run first)")
	}
	agentOrg := agent.GetMetadata().GetOrg()
	agentSlug := agent.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent shares for cascade delete")
	}

	deleted := 0
	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			continue
		}
		ref := share.GetSpec().GetAgentRef()
		if ref.GetOrg() != agentOrg || ref.GetSlug() != agentSlug {
			continue
		}
		if share.GetMetadata().GetOrg() != agentOrg {
			// A cross-org share — another org's resource. Fails closed via
			// the agent-id pin instead of being deleted here.
			continue
		}
		shareID := share.GetMetadata().GetId()
		if err := s.store.DeleteResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share, shareID); err != nil {
			return grpclib.InternalError(err, fmt.Sprintf(
				"failed to cascade-delete share %s of agent %s/%s", shareID, agentOrg, agentSlug))
		}
		deleted++
	}

	if deleted > 0 {
		log.Info().
			Int("count", deleted).
			Str("agent", agentOrg+"/"+agentSlug).
			Msg("Cascade-deleted shares of agent")
	}
	return nil
}
