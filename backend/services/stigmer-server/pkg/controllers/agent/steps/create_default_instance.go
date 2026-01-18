package steps

import (
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// CreateDefaultInstanceStep creates a default agent instance for the newly created agent.
//
// This step (when implemented) will:
// 1. Build AgentInstance request with no environment_refs
// 2. Call AgentInstanceController.Create() (in-process gRPC or direct call)
// 3. Store returned default_instance_id in context for next step
//
// Architecture note: Uses downstream controller to maintain domain separation.
// The agent instance creation handler handles all persistence and validation.
// This step does NOT update agent status - that's done in UpdateAgentStatusWithDefaultInstanceStep.
//
// Status: TODO - Requires AgentInstance controller implementation
type CreateDefaultInstanceStep struct {
	// agentInstanceController *AgentInstanceController // TODO: Add when ready
}

func NewCreateDefaultInstanceStep() *CreateDefaultInstanceStep {
	return &CreateDefaultInstanceStep{}
}

func (s *CreateDefaultInstanceStep) Name() string {
	return "CreateDefaultInstance"
}

func (s *CreateDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance controller is ready
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	// agentSlug := agent.Metadata.Name
	//
	// // Build default instance request
	// instanceName := agentSlug + "-default"
	// instanceRequest := &agentinstancev1.AgentInstance{
	//     Metadata: &apiresource.ApiResourceMetadata{
	//         Name: instanceName,
	//         OwnerScope: agent.Metadata.OwnerScope,
	//         Org: agent.Metadata.Org, // if org-scoped
	//     },
	//     Spec: &agentinstancev1.AgentInstanceSpec{
	//         AgentId: agentID,
	//         Description: "Default instance (auto-created, no custom configuration)",
	//     },
	// }
	//
	// // Create instance via controller (or gRPC)
	// createdInstance, err := s.agentInstanceController.Create(ctx.Context(), instanceRequest)
	// if err != nil {
	//     return fmt.Errorf("failed to create default instance: %w", err)
	// }
	//
	// // Store instance ID in context for next step
	// ctx.Set(DefaultInstanceIDKey, createdInstance.Metadata.Id)

	return nil // Skip for now
}
