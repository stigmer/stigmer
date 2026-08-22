package agentexecution

import (
	"context"
	"errors"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// seedMemoryOrg persists an organization with the memory switch in the
// requested position (the recall gate this step composes against).
func seedMemoryOrg(t *testing.T, s store.Store, orgID string, memoryEnabled bool) {
	t.Helper()
	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Id: orgID, Name: orgID, Org: orgID},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{MemoryEnabled: memoryEnabled},
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_organization, orgID, org); err != nil {
		t.Fatalf("failed to seed org: %v", err)
	}
}

// seedMemory persists a memory record with full control over the fields the
// recall filter reads: org, subject, lifecycle state, and the spec-audit
// create time the cross-edition ordering sorts on.
func seedMemory(
	t *testing.T,
	s store.Store,
	id, orgID, subject, content string,
	state memoryv1.MemoryLifecycleState,
	createdAt time.Time,
) {
	t.Helper()
	memory := &memoryv1.Memory{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Memory",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id, Org: orgID},
		Spec: &memoryv1.MemorySpec{
			Content:                  content,
			SubjectIdentityAccountId: subject,
		},
		Status: &memoryv1.MemoryStatus{
			LifecycleState: state,
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{CreatedAt: timestamppb.New(createdAt)},
			},
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_memory, id, memory); err != nil {
		t.Fatalf("failed to seed memory: %v", err)
	}
}

// failingListStore wraps a real store but fails every ListResources,
// simulating a store fault during the memory scan (after the org load
// succeeded — the failure mode failingGetStore cannot reach).
type failingListStore struct {
	store.Store
}

func (f *failingListStore) ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error) {
	return nil, errors.New("simulated store fault")
}

// TestComposeRecalledMemoriesStep verifies the step's whole contract:
// confirmed-only recall in cross-edition (oldest-first) order when the org
// flag is on, enabled-with-zero-facts as a meaningful stamped state, a
// DISABLED snapshot in every degraded case — and, critically, the
// server-owned overwrite: caller-supplied recalled_memories never survive.
func TestComposeRecalledMemoriesStep(t *testing.T) {
	baseTime := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)

	type seededMemory struct {
		id      string
		subject string
		content string
		state   memoryv1.MemoryLifecycleState
		offset  time.Duration // from baseTime, controls the recall order
	}

	tests := []struct {
		name          string
		orgID         string
		seedOrg       bool
		memoryEnabled bool
		memories      []seededMemory
		failingGet    bool
		failingList   bool
		wantEnabled   bool
		wantMemoryIDs []string // expected fact order (empty -> no facts)
	}{
		{
			name:          "confirmed memories recalled oldest-first, verbatim",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			memories: []seededMemory{
				// Seeded newest-first to prove the sort does the ordering.
				{id: "mem_newer", content: "Prefers OpenTofu.", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: time.Hour},
				{id: "mem_older", content: "Deploys to us-east-1.", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: 0},
			},
			wantEnabled:   true,
			wantMemoryIDs: []string{"mem_older", "mem_newer"},
		},
		{
			name:          "proposed and rejected records are never injected",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			memories: []seededMemory{
				{id: "mem_proposed", content: "unconfirmed", state: memoryv1.MemoryLifecycleState_lifecycle_state_proposed, offset: 0},
				{id: "mem_rejected", content: "rejected", state: memoryv1.MemoryLifecycleState_lifecycle_state_rejected, offset: time.Minute},
				{id: "mem_confirmed", content: "confirmed", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: 2 * time.Minute},
			},
			wantEnabled:   true,
			wantMemoryIDs: []string{"mem_confirmed"},
		},
		{
			name:          "other org's and non-sentinel-subject records are filtered out",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			memories: []seededMemory{
				{id: "mem_mine", content: "mine", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: 0},
				// A cloud-style subject-keyed record (e.g. from a restored
				// backup) must not leak into the OSS sentinel's recall.
				{id: "mem_subject", subject: "ia_someone", content: "not mine", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: time.Minute},
			},
			wantEnabled:   true,
			wantMemoryIDs: []string{"mem_mine"},
		},
		{
			name:          "org flag on with zero confirmed facts -> enabled=true, no facts (remember-tool signal)",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			wantEnabled:   true,
		},
		{
			name:    "org flag off -> disabled snapshot (default-off design)",
			orgID:   "test-org",
			seedOrg: true,
			memories: []seededMemory{
				{id: "mem_confirmed", content: "confirmed", state: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed, offset: 0},
			},
		},
		{
			name:  "org not found -> disabled snapshot, create unaffected",
			orgID: "ghost-org",
		},
		{
			name: "no org on metadata -> disabled snapshot, create unaffected",
		},
		{
			name:          "org load fault -> disabled snapshot, create unaffected (best-effort)",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			failingGet:    true,
		},
		{
			name:          "memory scan fault -> DISABLED, never enabled-with-zero-facts (broken recall must not offer the remember tool)",
			orgID:         "test-org",
			seedOrg:       true,
			memoryEnabled: true,
			failingList:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newStore(t)
			if tt.seedOrg {
				seedMemoryOrg(t, s, tt.orgID, tt.memoryEnabled)
			}
			for _, m := range tt.memories {
				seedMemory(t, s, m.id, tt.orgID, m.subject, m.content, m.state, baseTime.Add(m.offset))
			}
			var stepStore store.Store = s
			if tt.failingGet {
				stepStore = &failingGetStore{Store: s}
			}
			if tt.failingList {
				stepStore = &failingListStore{Store: s}
			}
			step := newComposeRecalledMemoriesStep(stepStore)

			execution := newExecution("ses_1", "agt_1")
			execution.Metadata.Org = tt.orgID
			// The injection attempt: a caller-supplied value must never
			// survive — the field is server-owned (DD-006 D2).
			execution.Spec.RecalledMemories = &agentexecutionv1.RecalledMemories{
				Enabled: true,
				Facts: []*agentexecutionv1.RecalledMemoryFact{
					{MemoryId: "mem_injected", Content: "injected fact"},
				},
			}
			reqCtx := pipeline.NewRequestContext(context.Background(), execution)

			if err := step.Execute(reqCtx); err != nil {
				t.Fatalf("step must never fail the create (best-effort contract), got: %v", err)
			}

			// The step's contract is SPEC-ONLY: status.recalled_memories_report
			// is runner-owned with a single writer (DD-008 D5) — the create
			// pipeline never stamps it, on any path. If a future change makes
			// this step (or the create pipeline around it) write the report,
			// this pin fails and forces the DD-008 ownership conversation.
			if report := reqCtx.NewState().GetStatus().GetRecalledMemoriesReport(); report != nil {
				t.Fatalf("the compose step must never write status.recalled_memories_report (runner-owned, DD-008 D5), got %v", report)
			}

			got := reqCtx.NewState().GetSpec().GetRecalledMemories()
			if got == nil {
				t.Fatal("recalled_memories must be stamped on every path (server-owned field), got nil")
			}
			if got.GetEnabled() != tt.wantEnabled {
				t.Errorf("enabled: want %v, got %v", tt.wantEnabled, got.GetEnabled())
			}
			if len(got.GetFacts()) != len(tt.wantMemoryIDs) {
				t.Fatalf("facts: want %d, got %d (%v)", len(tt.wantMemoryIDs), len(got.GetFacts()), got.GetFacts())
			}
			for i, wantID := range tt.wantMemoryIDs {
				fact := got.GetFacts()[i]
				if fact.GetMemoryId() != wantID {
					t.Errorf("facts[%d].memory_id: want %q, got %q (order must be oldest-first, matching cloud)", i, wantID, fact.GetMemoryId())
				}
				if fact.GetContent() == "" {
					t.Errorf("facts[%d].content must carry the stored content verbatim, got empty", i)
				}
			}
		})
	}
}
