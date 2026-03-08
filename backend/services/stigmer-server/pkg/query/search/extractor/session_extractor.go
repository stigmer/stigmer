package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// SessionExtractor extracts searchable data from Session resources.
//
// Sessions are conversation threads between a user and an agent instance.
// The search summary uses spec.subject (the conversation topic).
type SessionExtractor struct{}

var _ SearchableExtractor = (*SessionExtractor)(nil)

func init() {
	Register(&SessionExtractor{})
}

func (e *SessionExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_session
}

func (e *SessionExtractor) NewEmptyProto() proto.Message {
	return &sessionv1.Session{}
}

func (e *SessionExtractor) GetSearchSummary(resource proto.Message) string {
	session, ok := resource.(*sessionv1.Session)
	if !ok || session.GetSpec() == nil {
		return ""
	}
	return session.GetSpec().GetSubject()
}

func (e *SessionExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	session, ok := resource.(*sessionv1.Session)
	if !ok {
		return nil
	}

	meta := session.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_session,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   e.GetSearchSummary(resource),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	if audit := session.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				result.CreatedAt = specAudit.GetCreatedAt()
			}
			if specAudit.GetUpdatedAt() != nil {
				result.UpdatedAt = specAudit.GetUpdatedAt()
			}
		}
	}

	if result.CreatedAt == nil {
		result.CreatedAt = &timestamppb.Timestamp{}
	}
	if result.UpdatedAt == nil {
		result.UpdatedAt = &timestamppb.Timestamp{}
	}

	return result
}

func (e *SessionExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	session, ok := resource.(*sessionv1.Session)
	if !ok {
		return nil
	}

	meta := session.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:        meta.GetName(),
		Description: e.GetSearchSummary(resource),
		Tags:        JoinTags(meta.GetTags()),
		Org:         meta.GetOrg(),
		Visibility:  meta.GetVisibility().String(),
	}

	if audit := session.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
