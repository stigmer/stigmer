package migration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// BootstrapResult summarizes the outcome of the version bootstrap migration.
type BootstrapResult struct {
	Processed int
	Skipped   int
	Errors    int
}

func (r *BootstrapResult) String() string {
	return fmt.Sprintf("processed=%d skipped=%d errors=%d", r.Processed, r.Skipped, r.Errors)
}

// BootstrapWorkflowVersions backfills initial version_hash for existing workflows
// that were created before the versioning feature was introduced.
//
// For each workflow where status.version_hash is empty, the validation state is VALID,
// and the validated YAML is non-empty, it computes the SHA-256 hash and creates the
// initial audit entry. This makes pre-existing workflows appear in version history.
func BootstrapWorkflowVersions(ctx context.Context, s store.Store) (*BootstrapResult, error) {
	result := &BootstrapResult{}

	records, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow)
	if err != nil {
		return nil, fmt.Errorf("failed to list workflows: %w", err)
	}

	log.Info().Int("total_workflows", len(records)).Msg("Starting workflow version bootstrap migration")

	for _, data := range records {
		var wf workflowv1.Workflow
		if err := proto.Unmarshal(data, &wf); err != nil {
			log.Error().Err(err).Msg("Failed to unmarshal workflow record")
			result.Errors++
			continue
		}

		if shouldSkip(&wf) {
			result.Skipped++
			continue
		}

		if err := bootstrapSingleWorkflow(ctx, s, &wf); err != nil {
			log.Error().
				Err(err).
				Str("workflow_id", wf.GetMetadata().GetId()).
				Str("workflow_name", wf.GetMetadata().GetName()).
				Msg("Failed to bootstrap workflow version")
			result.Errors++
			continue
		}

		result.Processed++
	}

	log.Info().
		Int("processed", result.Processed).
		Int("skipped", result.Skipped).
		Int("errors", result.Errors).
		Msg("Workflow version bootstrap migration complete")

	return result, nil
}

// shouldSkip returns true if the workflow already has a version hash,
// has no valid YAML, or hasn't passed validation.
func shouldSkip(wf *workflowv1.Workflow) bool {
	if wf.GetStatus().GetVersionHash() != "" {
		return true
	}

	validation := wf.GetStatus().GetServerlessWorkflowValidation()
	if validation == nil {
		return true
	}
	if validation.GetState() != serverless.ValidationState_VALID {
		return true
	}
	if validation.GetYaml() == "" {
		return true
	}

	return false
}

func bootstrapSingleWorkflow(ctx context.Context, s store.Store, wf *workflowv1.Workflow) error {
	yaml := wf.GetStatus().GetServerlessWorkflowValidation().GetYaml()
	hash := sha256.Sum256([]byte(yaml))
	hexHash := hex.EncodeToString(hash[:])

	wf.Status.VersionHash = hexHash

	if wf.Metadata == nil {
		wf.Metadata = &apiresource.ApiResourceMetadata{}
	}
	if wf.Metadata.Version == nil {
		wf.Metadata.Version = &apiresource.ApiResourceMetadataVersion{}
	}
	wf.Metadata.Version.Id = hexHash

	workflowID := wf.GetMetadata().GetId()
	kind := apiresourcekind.ApiResourceKind_workflow

	if err := s.SaveResource(ctx, kind, workflowID, wf); err != nil {
		return fmt.Errorf("save resource: %w", err)
	}

	if err := s.SaveAudit(ctx, kind, workflowID, wf, hexHash, ""); err != nil {
		return fmt.Errorf("save audit: %w", err)
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Str("version_hash", hexHash[:12]+"...").
		Msg("Bootstrapped workflow version")

	return nil
}
