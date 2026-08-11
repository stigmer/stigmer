package workflow

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const (
	listVersionsDefaultPageSize = 50
	listVersionsMaxPageSize     = 100
	listVersionsWorkflowIDKey   = "listVersionsWorkflowId"
	listVersionsHeadHashKey     = "listVersionsHeadHash"
)

// ListVersions returns the version history for a workflow, identified by org and slug.
func (c *WorkflowController) ListVersions(ctx context.Context, req *workflowv1.ListWorkflowVersionsInput) (*workflowv1.ListWorkflowVersionsResponse, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListVersionsPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	resp := reqCtx.Get("listVersionsResponse").(*workflowv1.ListWorkflowVersionsResponse)
	return resp, nil
}

func (c *WorkflowController) buildListVersionsPipeline() *pipeline.Pipeline[*workflowv1.ListWorkflowVersionsInput] {
	return pipeline.NewPipeline[*workflowv1.ListWorkflowVersionsInput]("workflow-list-versions").
		AddStep(steps.NewValidateProtoStep[*workflowv1.ListWorkflowVersionsInput]()).
		AddStep(newResolveWorkflowBySlugStep(c.store)).
		AddStep(newLoadAndMapWorkflowVersionsStep(c.store)).
		Build()
}

// resolveWorkflowBySlugStep finds the workflow by org+slug and stores its ID in context.
type resolveWorkflowBySlugStep struct {
	store store.Store
}

func newResolveWorkflowBySlugStep(s store.Store) *resolveWorkflowBySlugStep {
	return &resolveWorkflowBySlugStep{store: s}
}

func (s *resolveWorkflowBySlugStep) Name() string {
	return "ResolveWorkflowBySlug"
}

func (s *resolveWorkflowBySlugStep) Execute(ctx *pipeline.RequestContext[*workflowv1.ListWorkflowVersionsInput]) error {
	req := ctx.Input()

	wf, found, err := steps.FindResourceBySlug[*workflowv1.Workflow](
		ctx.Context(),
		s.store,
		apiresourcekind.ApiResourceKind_workflow,
		req.Slug,
		req.Org,
	)
	if err != nil {
		return grpclib.InternalError(err, "failed to search for workflow")
	}
	if !found {
		return grpclib.NotFoundError("workflow", fmt.Sprintf("%s (org: %s)", req.Slug, req.Org))
	}

	ctx.Set(listVersionsWorkflowIDKey, wf.Metadata.Id)
	// The live head's hash decides is_current downstream. Under repoint
	// semantics (a rollback apply re-activates an archived version,
	// stigmer/stigmer#341) the current version need not be the
	// newest-archived row, so recency cannot stand in for currency.
	ctx.Set(listVersionsHeadHashKey, wf.GetStatus().GetVersionHash())
	return nil
}

// loadAndMapWorkflowVersionsStep loads audit records, maps to WorkflowVersionEntry, and paginates.
type loadAndMapWorkflowVersionsStep struct {
	store store.Store
}

func newLoadAndMapWorkflowVersionsStep(s store.Store) *loadAndMapWorkflowVersionsStep {
	return &loadAndMapWorkflowVersionsStep{store: s}
}

func (s *loadAndMapWorkflowVersionsStep) Name() string {
	return "LoadAndMapWorkflowVersions"
}

func (s *loadAndMapWorkflowVersionsStep) Execute(ctx *pipeline.RequestContext[*workflowv1.ListWorkflowVersionsInput]) error {
	req := ctx.Input()
	workflowID := ctx.Get(listVersionsWorkflowIDKey).(string)

	records, err := s.store.ListAuditRecords(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID)
	if err != nil {
		return grpclib.InternalError(err, "failed to load workflow version history")
	}

	// is_current = the entry whose hash matches the live head, not the newest
	// row: a rollback apply repoints the head at an older archived version
	// without inserting a new row (stigmer/stigmer#341), so recency and
	// currency legitimately diverge. Legacy data may hold duplicate-hash rows
	// (predating the repoint semantics); marking only the first match keeps
	// exactly-one-current true for them too.
	headHash, _ := ctx.Get(listVersionsHeadHashKey).(string)
	currentMarked := false
	entries := make([]*workflowv1.WorkflowVersionEntry, 0, len(records))
	for _, rec := range records {
		var wf workflowv1.Workflow
		if err := proto.Unmarshal(rec.Data, &wf); err != nil {
			continue
		}
		isCurrent := !currentMarked && headHash != "" && wf.GetStatus().GetVersionHash() == headHash
		currentMarked = currentMarked || isCurrent
		// Tag comes from the audit column (source of truth), not the snapshot.
		entries = append(entries, mapWorkflowToVersionEntry(&wf, isCurrent, rec.Tag))
	}

	// Pagination
	pageSize := int(req.PageSize)
	if pageSize <= 0 {
		pageSize = listVersionsDefaultPageSize
	}
	if pageSize > listVersionsMaxPageSize {
		pageSize = listVersionsMaxPageSize
	}

	startIndex := 0
	if req.PageToken != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.PageToken)
		if err != nil {
			return grpclib.InvalidArgumentError("invalid page_token")
		}
		idx, err := strconv.Atoi(string(decoded))
		if err != nil || idx < 0 {
			return grpclib.InvalidArgumentError("invalid page_token")
		}
		startIndex = idx
	}

	totalCount := int32(len(entries))

	var pageEntries []*workflowv1.WorkflowVersionEntry
	var nextPageToken string

	if startIndex < len(entries) {
		end := startIndex + pageSize
		if end > len(entries) {
			end = len(entries)
		}
		pageEntries = entries[startIndex:end]

		if end < len(entries) {
			nextPageToken = base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(end)))
		}
	}

	ctx.Set("listVersionsResponse", &workflowv1.ListWorkflowVersionsResponse{
		Versions:      pageEntries,
		NextPageToken: nextPageToken,
		TotalCount:    totalCount,
	})

	return nil
}
