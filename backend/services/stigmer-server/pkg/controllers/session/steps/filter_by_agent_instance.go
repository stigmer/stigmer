package steps

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// filterByAgentInstanceStep loads all sessions and filters by agent_instance_id
//
// This step:
// 1. Extracts agent_id from ListSessionsByAgentRequest
// 2. Lists all sessions from database
// 3. Filters sessions where spec.agent_instance_id matches
// 4. Stores filtered sessions in context for BuildListResponseStep
//
// Note: This is a simple implementation for OSS local usage.
// In production multi-tenant systems, this would be combined with IAM authorization
// filtering using an efficient database query (not in-memory filtering).
type filterByAgentInstanceStep struct {
	store *badger.Store
}

// NewFilterByAgentInstanceStep creates a new filter-by-agent-instance step
func NewFilterByAgentInstanceStep(store *badger.Store) *filterByAgentInstanceStep {
	return &filterByAgentInstanceStep{store: store}
}

func (s *filterByAgentInstanceStep) Name() string {
	return "FilterByAgentInstance"
}

func (s *filterByAgentInstanceStep) Execute(ctx *pipeline.RequestContext[*sessionv1.ListSessionsByAgentRequest]) error {
	req := ctx.Input()
	agentInstanceID := req.GetAgentId()

	if agentInstanceID == "" {
		return grpclib.InvalidArgumentError("agent_id is required")
	}

	log.Debug().
		Str("agent_instance_id", agentInstanceID).
		Msg("Filtering sessions by agent instance")

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// List all sessions from database
	data, err := s.store.ListResources(ctx.Context(), kind)
	if err != nil {
		log.Error().
			Err(err).
			Str("kind", kind.String()).
			Msg("Failed to list sessions")
		return grpclib.InternalError(err, "failed to list sessions")
	}

	// Filter sessions by agent_instance_id
	var filteredSessions []*sessionv1.Session
	for _, d := range data {
		session := &sessionv1.Session{}
		if err := protojson.Unmarshal(d, session); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal session, skipping")
			continue
		}

		// Filter by agent_instance_id
		if session.GetSpec().GetAgentInstanceId() == agentInstanceID {
			filteredSessions = append(filteredSessions, session)
		}
	}

	log.Info().
		Str("agent_instance_id", agentInstanceID).
		Int("total_sessions", len(data)).
		Int("filtered_sessions", len(filteredSessions)).
		Msg("Filtered sessions by agent instance")

	// Build response and store in context
	sessionList := &sessionv1.SessionList{
		Entries: filteredSessions,
	}
	ctx.Set("listResult", sessionList)

	return nil
}
