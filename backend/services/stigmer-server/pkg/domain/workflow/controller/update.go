package workflow

import (
	"context"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing workflow using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate (Layer 1)
// 2. ValidateWorkflowSpec - Validate workflow spec in-process (Layer 2: proto → CNCF YAML + structural checks - SSOT)
// 3. ResolveSlug - Generate slug from metadata.name
// 4. LoadExisting - Load existing workflow from repository to verify it exists
// 5. BuildUpdateState - Merge spec, preserve IDs and status, update audit timestamps
// 6. Persist - Save updated workflow to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowController) Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow update
func (c *WorkflowController) buildUpdatePipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-update").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).                                      // 1. Validate field constraints (Layer 1)
		AddStep(newValidateWorkflowSpecStep(c.validator)).                                                // 2. In-process validation (proto → CNCF YAML + structural checks)
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).                                        // 3. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowv1.Workflow](c.store)).                                // 4. Load existing workflow
		AddStep(steps.NewBuildUpdateStateStep[*workflowv1.Workflow]()).                                   // 5. Build updated state (merge spec, preserve status, update audit)
		AddStep(steps.NewNormalizeReferencesStep[*workflowv1.Workflow]()).                                // 6. Normalize cross-references
		AddStep(newPopulateServerlessValidationStepForUpdate()).                                          // 7. Refresh serverless validation YAML on update
		AddStep(newComputeVersionHashStep()).                                                             // 8. Compute SHA-256 of CNCF YAML
		AddStep(newCheckVersionChangedStep()).                                                            // 9. Compare hash with existing (skip audit if unchanged)
		AddStep(newPopulateVersionHashStep(false)).                                                       // 10. Set status.version_hash + metadata.version (if changed)
		AddStep(newSaveVersionAuditStep(c.store, false, false)).                                          // 11. Archive version (reverts hash on failure; Persist below flushes the revert)
		AddStep(steps.NewPersistStep[*workflowv1.Workflow](c.store)).                                     // 12. Persist workflow
		AddStep(steps.NewIndexSearchStep[*workflowv1.Workflow](c.store, &extractor.WorkflowExtractor{})). // 13. Update search index
		Build()
}
