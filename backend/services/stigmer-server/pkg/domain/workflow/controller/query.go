package workflow

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

var workflowHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Get retrieves a workflow by ID using the pipeline framework
func (c *WorkflowController) Get(ctx context.Context, workflowId *workflowv1.WorkflowId) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflowId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow from context
	workflow := reqCtx.Get(steps.TargetResourceKey).(*workflowv1.Workflow)
	return workflow, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
func (c *WorkflowController) buildGetPipeline() *pipeline.Pipeline[*workflowv1.WorkflowId] {
	return pipeline.NewPipeline[*workflowv1.WorkflowId]("workflow-get").
		AddStep(steps.NewValidateProtoStep[*workflowv1.WorkflowId]()).                           // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*workflowv1.WorkflowId, *workflowv1.Workflow](c.store)). // 2. Load by ID
		Build()
}

// GetByReference retrieves a workflow by ApiResourceReference with version support.
//
// Version resolution:
//   - Empty/"latest" → returns current head
//   - If version matches current workflow's status.version_hash → returns current
//   - 64-char hex string → queries audit by hash
//   - Other string → queries audit by tag (newest with that tag)
func (c *WorkflowController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*workflowv1.Workflow, error) {
	if ref == nil {
		return nil, grpclib.InvalidArgumentError("reference is required")
	}
	if ref.Slug == "" {
		return nil, grpclib.InvalidArgumentError("slug is required in reference")
	}

	// Step 1: Find main workflow by slug
	mainWorkflow, found, err := c.findMainWorkflowBySlug(ctx, ref.Slug, ref.Org)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, grpclib.NotFoundError("workflow", ref.Slug)
	}

	// Step 2: Determine which version to return
	version := strings.TrimSpace(ref.Version)

	if version == "" || version == "latest" {
		return mainWorkflow, nil
	}

	// Step 3: Check if version matches main workflow
	if c.workflowMatchesVersion(mainWorkflow, version) {
		return mainWorkflow, nil
	}

	// Step 4: Search audit records for the matching version
	auditWorkflow, found, err := c.findAuditWorkflowByVersion(ctx, mainWorkflow.Metadata.Id, version)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, grpclib.NotFoundError("workflow version", fmt.Sprintf("%s:%s", ref.Slug, version))
	}

	return auditWorkflow, nil
}

func (c *WorkflowController) findMainWorkflowBySlug(ctx context.Context, slug, org string) (*workflowv1.Workflow, bool, error) {
	resources, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list workflows")
	}

	for _, data := range resources {
		var wf workflowv1.Workflow
		if err := proto.Unmarshal(data, &wf); err != nil {
			continue
		}
		if wf.Metadata == nil {
			continue
		}
		if wf.Metadata.Slug == slug {
			if org != "" && wf.Metadata.Org != org {
				continue
			}
			return &wf, true, nil
		}
	}

	return nil, false, nil
}

func (c *WorkflowController) workflowMatchesVersion(wf *workflowv1.Workflow, version string) bool {
	if wf.Status == nil {
		return false
	}
	if workflowHashPattern.MatchString(version) {
		return wf.Status.VersionHash == version
	}
	if wf.Metadata != nil && wf.Metadata.Version != nil && wf.Metadata.Version.Tag == version {
		return true
	}
	return false
}

func (c *WorkflowController) findAuditWorkflowByVersion(ctx context.Context, workflowID, version string) (*workflowv1.Workflow, bool, error) {
	// A 64-hex value is an exact content hash; anything else is a tag. Either way
	// the returned snapshot's tag is overlaid from the audit column (the source
	// of truth) so callers never see a stale embedded tag after a tag move.
	var rec *store.AuditRecord
	var err error
	if workflowHashPattern.MatchString(version) {
		rec, err = c.store.GetAuditRecordByHash(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID, version)
	} else {
		rec, err = c.store.GetAuditRecordByTag(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID, version)
	}
	if err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return nil, false, nil
		}
		return nil, false, grpclib.InternalError(err, "failed to query workflow audit by version")
	}

	var wf workflowv1.Workflow
	if err := proto.Unmarshal(rec.Data, &wf); err != nil {
		return nil, false, grpclib.InternalError(err, "failed to decode archived workflow version")
	}
	overlayVersionTag(&wf, rec.Tag)
	return &wf, true, nil
}

// overlayVersionTag stamps the authoritative tag (from the audit column) onto a
// workflow snapshot's metadata.version.tag, so a resolved-by-reference workflow
// reflects the current tag rather than whatever was embedded at archival time.
func overlayVersionTag(wf *workflowv1.Workflow, tag string) {
	if wf.Metadata == nil {
		wf.Metadata = &apiresource.ApiResourceMetadata{}
	}
	if wf.Metadata.Version == nil {
		wf.Metadata.Version = &apiresource.ApiResourceMetadataVersion{}
	}
	wf.Metadata.Version.Tag = tag
}
