package session

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/types/known/timestamppb"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	commonspb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateSubject atomically sets spec.subject on an existing session.
//
// This is a field-level update: the server loads the current session,
// modifies only the subject field, updates audit timestamps, persists,
// and refreshes the search index. Because the read-modify-write happens
// entirely on the server, concurrent callers (e.g., GenerateSessionSubject
// and sandbox_manager) cannot overwrite each other's unrelated fields.
func (c *SessionController) UpdateSubject(
	ctx context.Context,
	req *sessionv1.UpdateSessionSubjectRequest,
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
	session.Spec.Subject = req.GetSubject()

	updateSpecAuditTimestamp(session)

	if err := c.store.SaveResource(ctx, kind, req.GetId(), session); err != nil {
		return nil, fmt.Errorf("persist session %s: %w", req.GetId(), err)
	}

	indexSessionSearch(ctx, c, kind, session)

	return session, nil
}

// updateSpecAuditTimestamp sets updated_at on the session's spec audit.
func updateSpecAuditTimestamp(session *sessionv1.Session) {
	now := timestamppb.Now()

	if session.Status == nil {
		session.Status = &commonspb.ApiResourceAuditStatus{}
	}
	if session.Status.Audit == nil {
		session.Status.Audit = &commonspb.ApiResourceAudit{}
	}
	if session.Status.Audit.SpecAudit == nil {
		session.Status.Audit.SpecAudit = &commonspb.ApiResourceAuditInfo{}
	}
	session.Status.Audit.SpecAudit.UpdatedAt = now
	session.Status.Audit.SpecAudit.Event = "updated"
}

// indexSessionSearch refreshes the FTS5 search index for a session.
// Best-effort: logs on failure but does not propagate the error.
func indexSessionSearch(
	ctx context.Context,
	c *SessionController,
	kind apiresourcekind.ApiResourceKind,
	session *sessionv1.Session,
) {
	ext := &extractor.SessionExtractor{}
	entry := ext.GetSearchIndexEntry(session)
	if entry == nil {
		return
	}
	if err := c.store.UpsertSearchIndex(ctx, kind, session.GetMetadata().GetId(), entry); err != nil {
		log.Warn().Err(err).
			Str("id", session.GetMetadata().GetId()).
			Msg("UpdateSubject: failed to update search index (best-effort)")
	}
}
