package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/valueobject"
)

// TestSearch_SessionListMode_ReturnsIndexedSessions is the query-side twin of
// the write pipelines' IndexSearch step: it proves a resource indexed on write
// actually comes back from a kind-scoped, org-scoped, list-mode search — the
// exact request shape the React SDK's useSessionSearch hook sends.
//
// This end-to-end pin exists because the gap it covers shipped three times
// (environment, project, session — stigmer/stigmer#310): the write side
// indexed every save while the read side never returned the kind, and no test
// exercised index→query as one path. The companion invariant test
// (TestSearchableKinds_CoverSearchIndexedProtoKinds, valueobject package)
// guards the allowlist contract; this one guards the wiring underneath it.
func TestSearch_SessionListMode_ReturnsIndexedSessions(t *testing.T) {
	ctx := context.Background()

	dbPath := filepath.Join(t.TempDir(), "test.sqlite")
	s, err := sqlite.NewStore(dbPath)
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	defer s.Close()

	// Seed through the same seams production writes use: SaveResource for the
	// document, the kind's extractor + UpsertSearchIndex for the FTS entry.
	seed := func(kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) {
		t.Helper()
		if err := s.SaveResource(ctx, kind, id, msg); err != nil {
			t.Fatalf("save %s %s: %v", kind, id, err)
		}
		ext, err := extractor.GetRegistry().GetExtractor(kind)
		if err != nil {
			t.Fatalf("extractor for %s: %v", kind, err)
		}
		entry := ext.GetSearchIndexEntry(msg)
		if entry == nil {
			t.Fatalf("extractor for %s returned nil index entry", kind)
		}
		if err := s.UpsertSearchIndex(ctx, kind, id, entry); err != nil {
			t.Fatalf("index %s %s: %v", kind, id, err)
		}
	}

	newSession := func(id, org, subject string) *sessionv1.Session {
		return &sessionv1.Session{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: id,
				Org:  org,
			},
			Spec: &sessionv1.SessionSpec{Subject: subject},
			Status: &apiresource.ApiResourceAuditStatus{
				Audit: &apiresource.ApiResourceAudit{
					SpecAudit: &apiresource.ApiResourceAuditInfo{
						CreatedAt: timestamppb.New(time.Now()),
					},
				},
			},
		}
	}

	seed(apiresourcekind.ApiResourceKind_session, "ses-acme-1", newSession("ses-acme-1", "acme", "Fix the deploy pipeline"))
	// Another org's session and a same-org non-session resource: the query
	// below must return neither.
	seed(apiresourcekind.ApiResourceKind_session, "ses-other-1", newSession("ses-other-1", "otherorg", "Unrelated thread"))
	seed(apiresourcekind.ApiResourceKind_agent, "agt-acme-1", &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agt-acme-1",
			Name: "acme-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{Description: "An agent in the same org"},
	})

	queryStore := NewSQLiteSearchQueryStore(s.DB(), s, extractor.GetRegistry())

	// The useSessionSearch request shape: kinds=[session], empty query
	// (list mode), org scope, first page.
	criteria, err := valueobject.NewSearchCriteria(
		[]apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_session},
		"", "acme", false, false, 1, 20,
	)
	if err != nil {
		t.Fatalf("build criteria: %v", err)
	}

	result, err := queryStore.Search(ctx, criteria)
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	if result.TotalCount() != 1 {
		t.Fatalf("expected exactly 1 result (the acme session), got %d", result.TotalCount())
	}
	got := result.Results()[0]
	if got.GetKind() != apiresourcekind.ApiResourceKind_session {
		t.Errorf("expected kind session, got %s", got.GetKind())
	}
	if got.GetId() != "ses-acme-1" {
		t.Errorf("expected ses-acme-1, got %s", got.GetId())
	}
	if got.GetDescription() != "Fix the deploy pipeline" {
		t.Errorf("expected the session subject as description, got %q", got.GetDescription())
	}
}
