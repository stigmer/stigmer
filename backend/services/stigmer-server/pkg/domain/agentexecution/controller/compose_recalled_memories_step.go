package agentexecution

import (
	"errors"
	"sort"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// composeRecalledMemoriesStep snapshots the subject's CONFIRMED memories
// onto the execution spec (DD-006 D2/D3, stigmer/stigmer#293 Phase 2
// Stage 2) — the recall half of the memory loop, sibling of
// composeDeclaredPreferencesStep in every invariant:
//
// The field is SERVER-OWNED: this step stamps spec.recalled_memories
// unconditionally — enabled=false with no facts on every ineligible or
// degraded path — overwriting anything the caller supplied, so injecting
// fake "memories" through the create request is moot by construction.
//
// BEST-EFFORT, deliberately inverting checkMemoryEnablementStep's
// fail-closed write gate (its doc comment anticipates exactly this step):
// an execution must never fail to start because its optional memories
// could not be loaded. Genuine load failures log at error level and
// degrade to a DISABLED snapshot — degrading to enabled-with-zero-facts
// instead would falsely offer the remember tool while recall is broken.
//
// OSS gates on the org flag ALONE with the empty-string subject sentinel
// (single-user local mode — DD-006 D1, the resolveMemoryDefaultsStep
// convention); the cloud edition additionally requires the caller's own
// memory_enabled and the strict first-party-human gate. enabled=true with
// zero facts is a meaningful state, stamped on purpose: memory is on,
// nothing stored yet — the runner still offers the remember tool
// (DD-005 D1; the enabled bit is the tool signal, no parallel flag).
//
// Recall stamps the CANDIDATE SET, CONFIRMED-ONLY: proposed and
// rejected records are never injected — the consent gate (DD-005) is
// meaningless otherwise. No compose-time truncation ever (DD-006 D5 as
// revised by DD-008): this step stamps every confirmed fact; above the
// retriever's activation threshold the shared runner selects the
// injected subset at prompt build and records it on
// status.recalled_memories_report — selection is runner-side, recorded,
// never silent (DD-008 D3/D5), and this step stays byte-identical
// either way. Facts are ordered oldest-first on
// status.audit.spec_audit.created_at to match the cloud repo's ORDER BY
// created_at ASC — identical prompt order in both editions. The
// full-scan-and-filter load matches the store's local/OSS posture at
// the kind's cap-bounded scale (the checkMemoryCapStep precedent).
//
// The Organization is loaded independently even though
// composeDeclaredPreferencesStep loaded it one step earlier: sharing via
// pipeline context would couple two independent best-effort steps to
// save one indexed read per create — step independence wins.
type composeRecalledMemoriesStep struct {
	store store.Store
}

func newComposeRecalledMemoriesStep(store store.Store) *composeRecalledMemoriesStep {
	return &composeRecalledMemoriesStep{store: store}
}

func (s *composeRecalledMemoriesStep) Name() string {
	return "ComposeRecalledMemories"
}

func (s *composeRecalledMemoriesStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	if execution.Spec == nil {
		execution.Spec = &agentexecutionv1.AgentExecutionSpec{}
	}

	// Claim the server-owned field first, before any load can fail: even the
	// degraded path must leave a disabled snapshot, never a caller-supplied one.
	execution.Spec.RecalledMemories = &agentexecutionv1.RecalledMemories{}
	defer ctx.SetNewState(execution)

	// The caller's org, matching session-ownership resolution in
	// createSessionIfNeededStep (org id == slug in OSS).
	orgID := execution.GetMetadata().GetOrg()
	if orgID == "" {
		orgID = ctx.Input().GetMetadata().GetOrg()
	}
	if orgID == "" {
		log.Debug().Msg("No org on execution metadata, composing no recalled memories")
		return nil
	}

	org := &organizationv1.Organization{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_organization, orgID, org); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("org_id", orgID).
				Msg("Org not found in store, composing no recalled memories")
			return nil
		}
		log.Error().
			Err(err).
			Str("org_id", orgID).
			Msg("Failed to load org for recalled memories - degrading to disabled (best-effort contract)")
		return nil
	}

	if !org.GetSpec().GetPreferences().GetMemoryEnabled() {
		// Default-off is the design (DD-006 D1), so this is the common path:
		// no log — a disabled snapshot is normal operation, not degradation.
		return nil
	}

	facts, err := s.loadConfirmedFacts(ctx, orgID)
	if err != nil {
		// Enabled stays false: a broken recall must not offer the remember
		// tool (the enabled bit doubles as the tool signal, DD-005 D1).
		log.Error().
			Err(err).
			Str("org_id", orgID).
			Msg("Failed to load memories for recall - degrading to disabled (best-effort contract)")
		return nil
	}

	execution.Spec.RecalledMemories.Enabled = true
	execution.Spec.RecalledMemories.Facts = facts

	log.Debug().
		Str("org_id", orgID).
		Int("fact_count", len(facts)).
		Msg("Composed recalled memories snapshot")

	return nil
}

// loadConfirmedFacts scans the memory kind and returns the confirmed
// records of the OSS single-user subject (the "" sentinel) in this org,
// oldest-first. Facts carry only memory_id + content: the id is the
// transparency link back to the addressable record (DD-006 D2);
// everything else stays on the record itself.
func (s *composeRecalledMemoriesStep) loadConfirmedFacts(
	ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution],
	orgID string,
) ([]*agentexecutionv1.RecalledMemoryFact, error) {
	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_memory)
	if err != nil {
		return nil, err
	}

	memories := make([]*memoryv1.Memory, 0, len(resources))
	for _, data := range resources {
		memory := &memoryv1.Memory{}
		if err := proto.Unmarshal(data, memory); err != nil {
			// Skip undecodable rows (should not happen in normal operation) —
			// one bad record must not take recall down for the rest.
			continue
		}
		if memory.GetMetadata().GetOrg() != orgID {
			continue
		}
		// The OSS single-user subject sentinel (resolveMemoryDefaultsStep
		// stamps "" at create; cloud stores the caller's identity account).
		if memory.GetSpec().GetSubjectIdentityAccountId() != "" {
			continue
		}
		if memory.GetStatus().GetLifecycleState() != memoryv1.MemoryLifecycleState_lifecycle_state_confirmed {
			continue
		}
		memories = append(memories, memory)
	}

	// Oldest-first on the same field listMemoriesByOrgStep sorts (inverted):
	// mirrors the cloud repo's ORDER BY created_at ASC so both editions
	// inject facts in the same order.
	sort.Slice(memories, func(i, j int) bool {
		ti := memories[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := memories[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return tj != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() < tj.GetSeconds()
		}
		return ti.GetNanos() < tj.GetNanos()
	})

	facts := make([]*agentexecutionv1.RecalledMemoryFact, 0, len(memories))
	for _, memory := range memories {
		facts = append(facts, &agentexecutionv1.RecalledMemoryFact{
			MemoryId: memory.GetMetadata().GetId(),
			Content:  memory.GetSpec().GetContent(),
		})
	}
	return facts, nil
}
