package activities

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ReadHarnessStateIdActivityImpl reads the harness_state_id from a session.
//
// For Cursor harness sessions, harness_state_id stores the Cursor agentId that was
// assigned by Cursor's backend on Agent.create(). The workflow calls this
// before each ExecuteCursor invocation so it passes the correct agentId:
//   - First execution: harness_state_id is empty (activity creates the Agent)
//   - After first ExecuteCursor stores the agentId: harness_state_id has the agentId
//   - HITL reinvocation: harness_state_id has the agentId for Agent.resume()
//
// This is a local activity (runs in-process, no task queue routing).
type ReadHarnessStateIdActivityImpl struct {
	store store.Store
}

func NewReadHarnessStateIdActivityImpl(store store.Store) *ReadHarnessStateIdActivityImpl {
	return &ReadHarnessStateIdActivityImpl{store: store}
}

func (a *ReadHarnessStateIdActivityImpl) ReadHarnessStateId(ctx context.Context, sessionID string) (string, error) {
	if sessionID == "" {
		return "", nil
	}

	session := &sessionv1.Session{}
	if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("Failed to load session for harness_state_id")
		return "", fmt.Errorf("load session %s for harness_state_id: %w", sessionID, err)
	}

	harnessStateID := session.GetSpec().GetHarnessStateId()
	log.Debug().
		Str("session_id", sessionID).
		Str("harness_state_id", harnessStateID).
		Msg("Read session harness_state_id")

	return harnessStateID, nil
}

const ReadHarnessStateIdActivityName = "ReadHarnessStateId"
