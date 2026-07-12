package workflow

import (
	"context"
	"errors"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const tagVersionResultKey = "tagVersionResult"

// TagVersion assigns or moves a tag to a specific workflow version.
//
// Tags are mutable, single-value pointers to immutable versions (git-tag
// semantics). Calling this with a tag that already points elsewhere moves it:
// the audit tag column — the single source of truth for a version's tag — is
// updated atomically to clear the prior holder and set the target. The live
// workflow's metadata.version.tag is then reconciled to mirror the head
// version's tag, so get / getByReference stay consistent.
//
// The dedicated tagVersion RPC and apply-time tagging both write through the
// same store.SetAuditTag primitive, so a tag can never name more than one
// version regardless of how it was assigned.
func (c *WorkflowController) TagVersion(ctx context.Context, req *workflowv1.TagWorkflowVersionInput) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildTagVersionPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(tagVersionResultKey).(*workflowv1.Workflow), nil
}

func (c *WorkflowController) buildTagVersionPipeline() *pipeline.Pipeline[*workflowv1.TagWorkflowVersionInput] {
	return pipeline.NewPipeline[*workflowv1.TagWorkflowVersionInput]("workflow-tag-version").
		AddStep(steps.NewValidateProtoStep[*workflowv1.TagWorkflowVersionInput]()). // 1. Validate field constraints (workflow_id, hash pattern, tag pattern)
		AddStep(newTagWorkflowVersionStep(c.store)).                                // 2. Move the tag and reconcile the live head
		Build()
}

// tagWorkflowVersionStep performs the tag move and reconciles the live head.
type tagWorkflowVersionStep struct {
	store store.Store
}

func newTagWorkflowVersionStep(s store.Store) *tagWorkflowVersionStep {
	return &tagWorkflowVersionStep{store: s}
}

func (s *tagWorkflowVersionStep) Name() string {
	return "TagWorkflowVersion"
}

func (s *tagWorkflowVersionStep) Execute(ctx *pipeline.RequestContext[*workflowv1.TagWorkflowVersionInput]) error {
	req := ctx.Input()

	// Load the live workflow to confirm it exists and to learn its head hash.
	var workflow workflowv1.Workflow
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, req.WorkflowId, &workflow); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("workflow", req.WorkflowId)
		}
		return grpclib.InternalError(err, "failed to load workflow")
	}

	// Move the tag in the audit store. A version_hash with no audit record
	// yields ErrAuditNotFound (the hash-exists check) and leaves the prior
	// holder untouched.
	if err := s.store.SetAuditTag(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, req.WorkflowId, req.VersionHash, req.Tag); err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return grpclib.NotFoundError("workflow version", req.VersionHash)
		}
		return grpclib.InternalError(err, "failed to assign workflow version tag")
	}

	// Reconcile the live workflow's metadata.version.tag to mirror the head
	// version's authoritative (post-move) tag. This uniformly covers tagging the
	// head, moving a tag off the head, and touching only archived versions.
	headTag, err := s.resolveHeadTag(ctx.Context(), req.WorkflowId, workflow.GetStatus().GetVersionHash())
	if err != nil {
		return err
	}

	var updated workflowv1.Workflow
	if err := s.store.UpdateResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, req.WorkflowId, &updated, func() error {
		if updated.Metadata == nil {
			updated.Metadata = &apiresource.ApiResourceMetadata{}
		}
		if updated.Metadata.Version == nil {
			updated.Metadata.Version = &apiresource.ApiResourceMetadataVersion{}
		}
		updated.Metadata.Version.Tag = headTag
		return nil
	}); err != nil {
		return grpclib.InternalError(err, "failed to reconcile workflow head tag")
	}

	ctx.Set(tagVersionResultKey, &updated)
	return nil
}

// resolveHeadTag returns the tag currently assigned to the workflow's head
// version, reading the audit tag column (the source of truth). An empty head
// hash or a head without an audit entry resolves to no tag.
func (s *tagWorkflowVersionStep) resolveHeadTag(ctx context.Context, workflowID, headHash string) (string, error) {
	if headHash == "" {
		return "", nil
	}

	rec, err := s.store.GetAuditRecordByHash(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID, headHash)
	if err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return "", nil
		}
		return "", grpclib.InternalError(err, "failed to resolve head version tag")
	}
	return rec.Tag, nil
}
