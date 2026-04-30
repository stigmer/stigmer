package activities

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ReadSessionThreadIdActivityImpl reads the thread_id from a session.
//
// For Cursor harness sessions, thread_id stores the Cursor agentId that was
// assigned by Cursor's backend on Agent.create(). The workflow calls this
// before each ExecuteCursor invocation so it passes the correct agentId:
//   - First execution: thread_id is empty (activity creates the Agent)
//   - After first ExecuteCursor stores the agentId: thread_id has the agentId
//   - HITL reinvocation: thread_id has the agentId for Agent.resume()
//
// This is a local activity (runs in-process, no task queue routing).
type ReadSessionThreadIdActivityImpl struct {
	store store.Store
}

func NewReadSessionThreadIdActivityImpl(store store.Store) *ReadSessionThreadIdActivityImpl {
	return &ReadSessionThreadIdActivityImpl{store: store}
}

func (a *ReadSessionThreadIdActivityImpl) ReadSessionThreadId(ctx context.Context, sessionID string) (string, error) {
	if sessionID == "" {
		return "", nil
	}

	session := &sessionv1.Session{}
	if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("Failed to load session for thread_id")
		return "", fmt.Errorf("load session %s for thread_id: %w", sessionID, err)
	}

	threadID := session.GetSpec().GetThreadId()
	log.Debug().
		Str("session_id", sessionID).
		Str("thread_id", threadID).
		Msg("Read session thread_id")

	return threadID, nil
}

const ReadSessionThreadIdActivityName = "ReadSessionThreadId"
