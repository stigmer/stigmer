package migration

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// BootstrapExecutionVersionsResult summarizes the execution backfill outcome.
type BootstrapExecutionVersionsResult struct {
	Processed int
	Skipped   int
	Errors    int
}

func (r *BootstrapExecutionVersionsResult) String() string {
	return fmt.Sprintf("processed=%d skipped=%d errors=%d", r.Processed, r.Skipped, r.Errors)
}

// BootstrapExecutionVersionHashes stamps workflow_version_hash on legacy executions
// that were created before versioning was introduced.
//
// For each execution where status.workflow_version_hash is empty AND the referenced
// workflow has exactly one version entry (the initial bootstrap version), we can
// deterministically stamp the execution — it must have used that single version.
//
// Executions whose workflows have multiple versions are left unstamped because
// we cannot determine which version was active at execution creation time.
//
// This migration should run AFTER BootstrapWorkflowVersions, since it depends on
// workflows already having their version_hash populated and audit entries created.
func BootstrapExecutionVersionHashes(ctx context.Context, s store.Store) (*BootstrapExecutionVersionsResult, error) {
	result := &BootstrapExecutionVersionsResult{}

	records, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		return nil, fmt.Errorf("failed to list workflow executions: %w", err)
	}

	log.Info().Int("total_executions", len(records)).Msg("Starting execution version hash backfill")

	// Cache workflow version counts to avoid repeated audit queries.
	// Key: workflowId, Value: versionHash (only set when workflow has exactly 1 version)
	workflowSingleVersionCache := make(map[string]string)

	for _, data := range records {
		var exec workflowexecutionv1.WorkflowExecution
		if err := proto.Unmarshal(data, &exec); err != nil {
			log.Error().Err(err).Msg("Failed to unmarshal execution record")
			result.Errors++
			continue
		}

		if exec.GetStatus().GetWorkflowVersionHash() != "" {
			result.Skipped++
			continue
		}

		workflowID := exec.GetSpec().GetWorkflowId()
		if workflowID == "" {
			result.Skipped++
			continue
		}

		versionHash, err := resolveSingleVersionHash(ctx, s, workflowID, workflowSingleVersionCache)
		if err != nil {
			log.Error().
				Err(err).
				Str("execution_id", exec.GetMetadata().GetId()).
				Str("workflow_id", workflowID).
				Msg("Error resolving version hash for execution backfill")
			result.Errors++
			continue
		}

		if versionHash == "" {
			result.Skipped++
			continue
		}

		if exec.Status == nil {
			exec.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
		}
		exec.Status.WorkflowVersionHash = versionHash

		execID := exec.GetMetadata().GetId()
		if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, execID, &exec); err != nil {
			log.Error().
				Err(err).
				Str("execution_id", execID).
				Msg("Failed to save execution with backfilled version hash")
			result.Errors++
			continue
		}

		result.Processed++
	}

	log.Info().
		Int("processed", result.Processed).
		Int("skipped", result.Skipped).
		Int("errors", result.Errors).
		Msg("Execution version hash backfill complete")

	return result, nil
}

// resolveSingleVersionHash returns the version hash for a workflow that has exactly
// one audit entry. Returns empty string if the workflow has 0 or 2+ versions.
func resolveSingleVersionHash(
	ctx context.Context,
	s store.Store,
	workflowID string,
	cache map[string]string,
) (string, error) {
	if cached, ok := cache[workflowID]; ok {
		return cached, nil
	}

	count, err := s.CountAuditEntries(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID)
	if err != nil {
		return "", fmt.Errorf("count audit entries for %s: %w", workflowID, err)
	}

	if count != 1 {
		cache[workflowID] = ""
		return "", nil
	}

	hash, err := s.GetLatestAuditHash(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID)
	if err != nil {
		return "", fmt.Errorf("get latest audit hash for %s: %w", workflowID, err)
	}

	cache[workflowID] = hash
	return hash, nil
}
