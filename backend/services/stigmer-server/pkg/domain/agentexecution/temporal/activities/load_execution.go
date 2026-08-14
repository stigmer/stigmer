package activities

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// LoadAgentExecutionActivityImpl loads an AgentExecution from the store by ID.
//
// This is a local activity (runs in-process, no task queue routing) used by the
// workflow when it needs the current state of the execution from the system of
// record -- for example, when completing an external activity with the callback
// token pattern.
//
// Historically the workflow held a stale copy of the execution (the workflow input).
// Loading from DB ensures the result reflects all status updates made by the
// runner during execution.
type LoadAgentExecutionActivityImpl struct {
	store store.Store
}

// NewLoadAgentExecutionActivityImpl creates a new LoadAgentExecutionActivityImpl.
func NewLoadAgentExecutionActivityImpl(store store.Store) *LoadAgentExecutionActivityImpl {
	return &LoadAgentExecutionActivityImpl{store: store}
}

// LoadAgentExecution loads the current AgentExecution from the store by ID.
func (a *LoadAgentExecutionActivityImpl) LoadAgentExecution(ctx context.Context, executionID string) (*agentexecutionv1.AgentExecution, error) {
	log.Debug().
		Str("execution_id", executionID).
		Msg("Loading agent execution from store")

	execution := &agentexecutionv1.AgentExecution{}
	if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to load agent execution")
		return nil, fmt.Errorf("load agent execution %s: %w", executionID, err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.GetStatus().GetPhase().String()).
		Msg("Loaded agent execution from store")

	return execution, nil
}

// LoadAgentExecutionActivityName is the activity name for registration.
const LoadAgentExecutionActivityName = "LoadAgentExecution"
