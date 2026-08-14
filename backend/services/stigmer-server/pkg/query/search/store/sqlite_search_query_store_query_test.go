package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
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
// newSeededSQLiteStore creates a real SQLite store in a temp dir plus a seed
// function that writes through the same seams production writes use:
// SaveResource for the document, the kind's extractor + UpsertSearchIndex for
// the FTS entry. The store is closed via t.Cleanup.
func newSeededSQLiteStore(t *testing.T, ctx context.Context) (*sqlite.Store, func(kind apiresourcekind.ApiResourceKind, id string, msg proto.Message)) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test.sqlite")
	s, err := sqlite.NewStore(dbPath)
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

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

	return s, seed
}

func TestSearch_SessionListMode_ReturnsIndexedSessions(t *testing.T) {
	ctx := context.Background()

	s, seed := newSeededSQLiteStore(t, ctx)

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

// TestSearch_OnlyNonSearchableKinds_ReturnsEmpty is the negative-space twin
// of the list-mode test above and the end-to-end pin for stigmer/stigmer#440:
// a request naming ONLY non-searchable kinds must return an empty page even
// when the org has indexed resources.
//
// The defect this kills: SearchCriteria used to filter requested kinds at
// construction, and EffectiveKinds read the emptied set as discover mode —
// so a raw search.query({kinds: [agent_execution]}) returned the org's
// agents, sessions, workflows... masquerading as the requested kind instead
// of an empty result. The store's empty-effective-kinds short-circuit is the
// contract for this state; this test proves the criteria actually reach it.
func TestSearch_OnlyNonSearchableKinds_ReturnsEmpty(t *testing.T) {
	ctx := context.Background()

	s, seed := newSeededSQLiteStore(t, ctx)

	// The org is NOT empty: a session and an agent are indexed. Before the
	// fix, exactly these came back as the "agent_execution" results.
	seed(apiresourcekind.ApiResourceKind_session, "ses-acme-1", &sessionv1.Session{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "ses-acme-1",
			Name: "ses-acme-1",
			Org:  "acme",
		},
		Spec: &sessionv1.SessionSpec{Subject: "Fix the deploy pipeline"},
		Status: &apiresource.ApiResourceAuditStatus{
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{
					CreatedAt: timestamppb.New(time.Now()),
				},
			},
		},
	})
	seed(apiresourcekind.ApiResourceKind_agent, "agt-acme-1", &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agt-acme-1",
			Name: "acme-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{Description: "An agent in the same org"},
	})

	queryStore := NewSQLiteSearchQueryStore(s.DB(), s, extractor.GetRegistry())

	// agent_channel is not_search_indexed by design (permanently, not
	// decision-pending — it lists via its dedicated query RPC), which makes
	// it the stable exemplar for this pin. The original exemplar,
	// agent_execution, joined SearchableKinds when stigmer/stigmer#439
	// closed the read-side parity gap. Both list mode and query mode must
	// be empty.
	for _, tc := range []struct {
		name  string
		query string
	}{
		{"list mode", ""},
		{"query mode", "acme"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			criteria, err := valueobject.NewSearchCriteria(
				[]apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent_channel},
				tc.query, "acme", false, false, 1, 20,
			)
			if err != nil {
				t.Fatalf("build criteria: %v", err)
			}

			result, err := queryStore.Search(ctx, criteria)
			if err != nil {
				t.Fatalf("search: %v", err)
			}

			if result.TotalCount() != 0 || len(result.Results()) != 0 {
				t.Fatalf(
					"expected an empty result for a request naming only non-searchable kinds, got %d results (total %d) — other kinds' resources are masquerading as the requested kind",
					len(result.Results()), result.TotalCount(),
				)
			}
		})
	}
}

// TestSearch_NewlySearchableKind_EndToEnd pins the stigmer/stigmer#439
// parity decision at the wiring level, using the kind whose emptiness the
// #440 test above used to demonstrate: agent_execution was indexed on every
// write yet returned nothing on read. After the six-kind parity landed, a
// kind-scoped, org-scoped request must serve it in both list mode and query
// mode — write → index → query as one path, the same shape the session pin
// at the top of this file guards.
func TestSearch_NewlySearchableKind_EndToEnd(t *testing.T) {
	ctx := context.Background()

	s, seed := newSeededSQLiteStore(t, ctx)

	newExecution := func(id, org string) *agentexecutionv1.AgentExecution {
		return &agentexecutionv1.AgentExecution{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: id,
				Org:  org,
			},
			Status: &agentexecutionv1.AgentExecutionStatus{
				Audit: &apiresource.ApiResourceAudit{
					SpecAudit: &apiresource.ApiResourceAuditInfo{
						CreatedAt: timestamppb.New(time.Now()),
					},
				},
			},
		}
	}

	seed(apiresourcekind.ApiResourceKind_agent_execution, "exe-acme-1", newExecution("exe-acme-1", "acme"))
	// Another org's execution and a same-org non-execution resource: the
	// kind- and org-scoped queries below must return neither.
	seed(apiresourcekind.ApiResourceKind_agent_execution, "exe-other-1", newExecution("exe-other-1", "otherorg"))
	seed(apiresourcekind.ApiResourceKind_session, "ses-acme-1", &sessionv1.Session{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "ses-acme-1",
			Name: "ses-acme-1",
			Org:  "acme",
		},
		Spec: &sessionv1.SessionSpec{Subject: "Fix the deploy pipeline"},
		Status: &apiresource.ApiResourceAuditStatus{
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{
					CreatedAt: timestamppb.New(time.Now()),
				},
			},
		},
	})

	queryStore := NewSQLiteSearchQueryStore(s.DB(), s, extractor.GetRegistry())

	// Executions index their name (they have no description field), so the
	// query-mode term matches the seeded name.
	for _, tc := range []struct {
		name  string
		query string
	}{
		{"list mode", ""},
		{"query mode", "exe-acme-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			criteria, err := valueobject.NewSearchCriteria(
				[]apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent_execution},
				tc.query, "acme", false, false, 1, 20,
			)
			if err != nil {
				t.Fatalf("build criteria: %v", err)
			}

			result, err := queryStore.Search(ctx, criteria)
			if err != nil {
				t.Fatalf("search: %v", err)
			}

			if result.TotalCount() != 1 {
				t.Fatalf("expected exactly 1 result (the acme execution), got %d", result.TotalCount())
			}
			got := result.Results()[0]
			if got.GetKind() != apiresourcekind.ApiResourceKind_agent_execution {
				t.Errorf("expected kind agent_execution, got %s", got.GetKind())
			}
			if got.GetId() != "exe-acme-1" {
				t.Errorf("expected exe-acme-1, got %s", got.GetId())
			}
		})
	}
}
