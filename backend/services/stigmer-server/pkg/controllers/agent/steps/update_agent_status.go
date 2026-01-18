package steps

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// UpdateAgentStatusWithDefaultInstanceStep updates agent status with default instance ID.
//
// This step (when implemented) will:
// 1. Read default_instance_id from context (set by CreateDefaultInstance)
// 2. Update agent status with default_instance_id
// 3. Persist updated agent to repository
// 4. Update context with persisted agent for response
//
// Separated from CreateDefaultInstance for pipeline clarity - makes it explicit
// that a database persist operation is happening.
//
// Status: TODO - Requires AgentInstance controller implementation
type UpdateAgentStatusWithDefaultInstanceStep struct {
	store *badger.Store
}

func NewUpdateAgentStatusWithDefaultInstanceStep(store *badger.Store) *UpdateAgentStatusWithDefaultInstanceStep {
	return &UpdateAgentStatusWithDefaultInstanceStep{store: store}
}

func (s *UpdateAgentStatusWithDefaultInstanceStep) Name() string {
	return "UpdateAgentStatusWithDefaultInstance"
}

func (s *UpdateAgentStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance is ready
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	//
	// // Read default instance ID from context
	// defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	// if !ok || defaultInstanceID == "" {
	//     return fmt.Errorf("default instance ID not found in context")
	// }
	//
	// // Update agent status
	// if agent.Status == nil {
	//     agent.Status = &agentv1.AgentStatus{}
	// }
	// agent.Status.DefaultInstanceId = defaultInstanceID
	//
	// // Persist updated agent
	// if err := s.store.SaveResource(ctx.Context(), "Agent", agentID, agent); err != nil {
	//     return fmt.Errorf("failed to persist agent with default instance: %w", err)
	// }
	//
	// // Update context with persisted agent for response
	// ctx.SetNewState(agent)

	return nil // Skip for now
}
