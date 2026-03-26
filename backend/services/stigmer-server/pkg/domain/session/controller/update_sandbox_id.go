package session

import (
	"context"
	"fmt"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// UpdateSandboxId atomically sets spec.sandbox_id on an existing session.
//
// This is a field-level update: the server loads the current session,
// modifies only the sandbox_id field, updates audit timestamps, persists,
// and returns the updated session. Because the read-modify-write happens
// entirely on the server, concurrent callers cannot overwrite each other's
// unrelated fields.
//
// No search index update is performed because sandbox_id is not a
// searchable field.
func (c *SessionController) UpdateSandboxId(
	ctx context.Context,
	req *sessionv1.UpdateSessionSandboxIdRequest,
) (*sessionv1.Session, error) {
	if req.GetId() == "" {
		return nil, fmt.Errorf("session id is required")
	}

	kind := apiresourcekind.ApiResourceKind_session

	session := &sessionv1.Session{}
	if err := c.store.GetResource(ctx, kind, req.GetId(), session); err != nil {
		return nil, fmt.Errorf("load session %s: %w", req.GetId(), err)
	}

	if session.Spec == nil {
		session.Spec = &sessionv1.SessionSpec{}
	}
	session.Spec.SandboxId = req.GetSandboxId()

	updateSpecAuditTimestamp(session)

	if err := c.store.SaveResource(ctx, kind, req.GetId(), session); err != nil {
		return nil, fmt.Errorf("persist session %s: %w", req.GetId(), err)
	}

	return session, nil
}
