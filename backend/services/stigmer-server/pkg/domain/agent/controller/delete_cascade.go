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

// Agent deletion cascades to the agent's org+slug-resolved children before
// the agent row itself is removed (children before parent, so a mid-failure
// retry converges — the same ordering the cloud edition's
// SessionDeleteHandler cascade established):
//
//   - The system-managed DEFAULT instance. Its slug is the deterministic
//     "<agent-slug>-default", so leaving it behind poisons a later recreate
//     at the same slug (the create pipeline's idempotent apply routes to
//     UPDATE on the orphan — see cloud design decision 010). Personal
//     instances are deliberately NOT cascaded: they reference the agent by
//     immutable ID (never reused), so they become inert dangling
//     references — the same posture sessions and executions already have.
//
//   - All AgentShares of the agent. Shares reference the agent by org+slug
//     (spec.agent_ref), so a stale share would silently rebind — audience,
//     link token, and bound credentials included — to whatever agent is
//     later created at that slug.
//
// Both editions implement this contract; the cloud edition additionally
// cleans up each child's FGA tuples (no IAM system in OSS).

// cascadeDeleteDefaultInstanceStep deletes the agent's system-managed
// default instance (row + search-index entry) before the agent is deleted.
//
// Resolution is authoritative-first: status.default_instance_id when set,
// else the "<agent-slug>-default" slug convention for legacy/half-created
// rows — guarded by spec.agent_id, so a personal instance that merely
// reuses the name is never touched.
type cascadeDeleteDefaultInstanceStep struct {
	store store.Store
}

func newCascadeDeleteDefaultInstanceStep(s store.Store) *cascadeDeleteDefaultInstanceStep {
	return &cascadeDeleteDefaultInstanceStep{store: s}
}

func (s *cascadeDeleteDefaultInstanceStep) Name() string {
	return "CascadeDeleteDefaultInstance"
}

func (s *cascadeDeleteDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.AgentId]) error {
	agent, ok := ctx.Get(steps.ExistingResourceKey).(*agentv1.Agent)
	if !ok {
		return grpclib.InternalError(nil, "agent not found in context (LoadExistingForDelete must run first)")
	}

	instanceID := s.resolveDefaultInstanceID(ctx, agent)
	if instanceID == "" {
		return nil
	}

	if err := s.store.DeleteResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instanceID); err != nil {
		return grpclib.InternalError(err, fmt.Sprintf(
			"failed to cascade-delete default instance %s of agent %s",
			instanceID, agent.GetMetadata().GetId()))
	}

	// Best-effort, matching DeleteSearchIndexStep: a stale index entry is a
	// cosmetic search artifact, not a correctness problem.
	if err := s.store.DeleteSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instanceID); err != nil {
		log.Warn().Err(err).
			Str("instance_id", instanceID).
			Msg("CascadeDeleteDefaultInstance: failed to remove search index entry (best-effort)")
	}

	log.Info().
		Str("instance_id", instanceID).
		Str("agent_id", agent.GetMetadata().GetId()).
		Msg("Cascade-deleted default instance of agent")
	return nil
}

// resolveDefaultInstanceID returns the default instance's ID, or "" when the
// agent has none (nothing to cascade).
func (s *cascadeDeleteDefaultInstanceStep) resolveDefaultInstanceID(ctx *pipeline.RequestContext[*agentv1.AgentId], agent *agentv1.Agent) string {
	if id := agent.GetStatus().GetDefaultInstanceId(); id != "" {
		return id
	}

	// Legacy/half-created agents may lack the status pointer; fall back to
	// the "<agent-slug>-default" naming convention (the shape
	// createDefaultInstanceStep provisions), guarded by spec.agent_id.
	defaultSlug := agent.GetMetadata().GetSlug() + "-default"
	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance)
	if err != nil {
		log.Warn().Err(err).Msg("CascadeDeleteDefaultInstance: failed to list instances for slug fallback")
		return ""
	}
	for _, data := range resources {
		instance := &agentinstancev1.AgentInstance{}
		if err := proto.Unmarshal(data, instance); err != nil {
			continue
		}
		if instance.GetSpec().GetAgentId() == agent.GetMetadata().GetId() &&
			instance.GetMetadata().GetSlug() == defaultSlug {
			return instance.GetMetadata().GetId()
		}
	}
	return ""
}

// cascadeDeleteSharesStep deletes every AgentShare referencing the agent
// before the agent is deleted.
//
// Shares are matched by spec.agent_ref (org + the AGENT's slug), which
// finds them all regardless of each share's own slug — a renamed share
// stays covered (decision 011, D2). AgentShare is not search-indexed, so
// there is no index entry to clean.
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
