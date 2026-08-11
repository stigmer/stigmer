package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowVersioning_RollbackApplyRepointsHead pins the content-addressed
// version identity contract (stigmer/stigmer#341) end-to-end against the real
// store and validator:
//
//   - an identical re-apply registers no new version (the changed-gate);
//   - a changed spec archives exactly one new version;
//   - re-applying a PRIOR version's spec repoints the head to the existing
//     audit row instead of inserting a duplicate — the history stays one row
//     per content, and listVersions marks the repointed-to entry current even
//     though it is not the newest-archived row.
//
// The rollback arm only became reachable with canonical YAML rendering: before
// it, hashes never repeated, so re-applying old content minted a fresh hash
// and a duplicate history entry.
func TestWorkflowVersioning_RollbackApplyRepointsHead(t *testing.T) {
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer s.Close()

	_, workflowInstanceConn, cleanup := setupInProcessServers(t, s)
	t.Cleanup(cleanup)

	// The real validator, so the pipeline renders real YAML and real hashes —
	// version registration is a no-op without them.
	controller := NewWorkflowController(
		s, workflowinstance.NewClient(workflowInstanceConn), validation.NewInProcessValidator())

	specWith := func(value string) *workflowv1.WorkflowSpec {
		taskConfig, err := structpb.NewStruct(map[string]interface{}{
			"variables": map[string]interface{}{"greeting": value},
		})
		if err != nil {
			t.Fatalf("failed to build task config: %v", err)
		}
		return &workflowv1.WorkflowSpec{
			Description: "version repoint test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      "version-repoint",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{{
				Name:       "setVars",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: taskConfig,
			}},
		}
	}

	created, err := controller.Create(contextWithWorkflowKind(), &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "Version Repoint", Org: "test-org"},
		Spec:       specWith("a"),
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	hashA := created.GetStatus().GetVersionHash()
	if hashA == "" {
		t.Fatal("create must compute a version hash")
	}

	// Identical re-apply: the changed-gate must not register a version.
	created.Spec = specWith("a")
	unchanged, err := controller.Update(contextWithWorkflowKind(), created)
	if err != nil {
		t.Fatalf("identical update failed: %v", err)
	}
	if got := unchanged.GetStatus().GetVersionHash(); got != hashA {
		t.Fatalf("identical spec must keep the head hash: got %s, want %s", got, hashA)
	}
	assertVersionHistory(t, controller, created.Metadata.Slug, []versionExpectation{
		{hash: hashA, isCurrent: true},
	})

	// Changed spec: exactly one new version, head advances.
	unchanged.Spec = specWith("b")
	atB, err := controller.Update(contextWithWorkflowKind(), unchanged)
	if err != nil {
		t.Fatalf("update to spec B failed: %v", err)
	}
	hashB := atB.GetStatus().GetVersionHash()
	if hashB == hashA {
		t.Fatal("a changed spec must change the version hash")
	}
	assertVersionHistory(t, controller, created.Metadata.Slug, []versionExpectation{
		{hash: hashB, isCurrent: true},
		{hash: hashA, isCurrent: false},
	})

	// Rollback: re-apply spec A. Canonical rendering reproduces hashA, which
	// is already archived — the head must repoint without a duplicate row.
	atB.Spec = specWith("a")
	rolledBack, err := controller.Update(contextWithWorkflowKind(), atB)
	if err != nil {
		t.Fatalf("rollback update failed: %v", err)
	}
	if got := rolledBack.GetStatus().GetVersionHash(); got != hashA {
		t.Fatalf("rollback must repoint the head to the prior hash: got %s, want %s", got, hashA)
	}
	if got := rolledBack.GetMetadata().GetVersion().GetPreviousVersionId(); got != hashB {
		t.Fatalf("rollback must chain previous_version_id to the replaced head: got %s, want %s", got, hashB)
	}
	// Still two entries — newest-archived first — with current on the OLDER
	// row: recency and currency legitimately diverge under repoint.
	assertVersionHistory(t, controller, created.Metadata.Slug, []versionExpectation{
		{hash: hashB, isCurrent: false},
		{hash: hashA, isCurrent: true},
	})
}

type versionExpectation struct {
	hash      string
	isCurrent bool
}

// assertVersionHistory asserts the exact newest-first version history and that
// exactly one entry is current.
func assertVersionHistory(t *testing.T, controller *WorkflowController, slug string, want []versionExpectation) {
	t.Helper()

	resp, err := controller.ListVersions(contextWithWorkflowKind(), &workflowv1.ListWorkflowVersionsInput{
		Org:  "test-org",
		Slug: slug,
	})
	if err != nil {
		t.Fatalf("ListVersions failed: %v", err)
	}
	if len(resp.Versions) != len(want) {
		t.Fatalf("version count = %d, want %d", len(resp.Versions), len(want))
	}

	currentCount := 0
	for i, entry := range resp.Versions {
		if entry.VersionHash != want[i].hash {
			t.Errorf("versions[%d].version_hash = %s, want %s", i, entry.VersionHash, want[i].hash)
		}
		if entry.IsCurrent != want[i].isCurrent {
			t.Errorf("versions[%d].is_current = %v, want %v", i, entry.IsCurrent, want[i].isCurrent)
		}
		if entry.IsCurrent {
			currentCount++
		}
		if entry.ValidatedYaml == "" {
			t.Errorf("versions[%d] must carry its executable YAML", i)
		}
	}
	if currentCount != 1 {
		t.Errorf("exactly one version must be current, got %d", currentCount)
	}
}
