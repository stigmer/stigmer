package reconcile

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// ProjectOwnershipAnnotation is the annotation key used to mark resources as owned by a project.
// Resources with this annotation set to a project ID are considered part of that project's
// actual state during reconciliation.
const ProjectOwnershipAnnotation = "stigmer.ai/sdk.project"

// reconciliationServiceImpl implements ReconciliationService.
//
// This implementation orchestrates the reconciliation process:
//  1. Parse desired state from Project.Spec
//  2. Fetch actual state from store (resources with project ownership annotation)
//  3. Build dependency graph
//  4. Compute diff to create reconciliation plan
//  5. Execute plan (stubbed in D4, full implementation in E2)
type reconciliationServiceImpl struct {
	store store.Store
}

// NewReconciliationService creates a new ReconciliationService.
//
// Parameters:
//   - store: The store for querying actual state
func NewReconciliationService(store store.Store) ReconciliationService {
	return &reconciliationServiceImpl{
		store: store,
	}
}

// Reconcile executes the reconciliation process for a project.
//
// See ReconciliationService interface for full documentation.
func (s *reconciliationServiceImpl) Reconcile(
	ctx context.Context,
	project *projectv1.Project,
	options *ReconciliationOptions,
) (*ReconciliationResult, error) {
	if project == nil {
		return nil, fmt.Errorf("project is nil")
	}
	if project.GetMetadata() == nil || project.GetMetadata().GetId() == "" {
		return nil, fmt.Errorf("project must have metadata.id set (must be persisted first)")
	}
	if options == nil {
		options = DefaultOptions()
	}

	projectID := project.GetMetadata().GetId()

	// Step 1: Parse desired state from Project.Spec
	desired := s.parseDesiredState(project)

	// Step 2: Fetch actual state from store
	actual, err := s.fetchActualState(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch actual state: %w", err)
	}

	// Step 3: Build dependency graph
	graph := BuildDependencyGraph(desired)

	// Step 4: Compute diff
	plan := ComputeDiff(desired, actual, graph)

	// Handle dry-run: return plan as result without execution
	if options.IsDryRun() {
		return s.planToResult(plan), nil
	}

	// Handle prune option: filter out deletes if pruning is disabled
	if !options.IsPruneEnabled() {
		plan = s.filterDeletes(plan)
	}

	// Step 5: Execute plan
	// Note: In D4, execution is stubbed. The plan is computed but changes
	// are not actually applied. Full execution will be implemented in E2.
	return s.executePlan(ctx, plan, projectID)
}

// parseDesiredState extracts resources from Project.Spec into a DesiredState.
//
// Resources are keyed by slug, which is generated from metadata.name if not set.
func (s *reconciliationServiceImpl) parseDesiredState(project *projectv1.Project) *DesiredState {
	spec := project.GetSpec()
	if spec == nil {
		return EmptyDesiredState()
	}

	agents := make(map[string]*agentv1.Agent)
	for _, agent := range spec.GetAgents() {
		slug := s.resolveSlug(agent)
		if slug != "" {
			agents[slug] = agent
		}
	}

	workflows := make(map[string]*workflowv1.Workflow)
	for _, workflow := range spec.GetWorkflows() {
		slug := s.resolveSlug(workflow)
		if slug != "" {
			workflows[slug] = workflow
		}
	}

	mcpServers := make(map[string]*mcpserverv1.McpServer)
	for _, mcpServer := range spec.GetMcpServers() {
		slug := s.resolveSlug(mcpServer)
		if slug != "" {
			mcpServers[slug] = mcpServer
		}
	}

	skills := make(map[string]*skillv1.Skill)
	for _, skill := range spec.GetSkills() {
		slug := s.resolveSlug(skill)
		if slug != "" {
			skills[slug] = skill
		}
	}

	return NewDesiredState(agents, workflows, mcpServers, skills)
}

// resolveSlug extracts or generates a slug for a resource.
//
// If metadata.slug is set, it is returned directly.
// Otherwise, generates a slug from metadata.name using the standard slug algorithm.
func (s *reconciliationServiceImpl) resolveSlug(resource proto.Message) string {
	metadataResource, ok := resource.(steps.HasMetadata)
	if !ok {
		return ""
	}
	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return ""
	}
	if metadata.Slug != "" {
		return metadata.Slug
	}
	if metadata.Name != "" {
		return steps.GenerateSlug(metadata.Name)
	}
	return ""
}

// fetchActualState queries the store for resources owned by the project.
//
// Ownership is determined by the ProjectOwnershipAnnotation in resource metadata.
func (s *reconciliationServiceImpl) fetchActualState(
	ctx context.Context,
	projectID string,
) (*ActualState, error) {
	annotationPath := "metadata.annotations." + ProjectOwnershipAnnotation

	// Fetch agents
	agents, err := s.fetchResourcesByAnnotation(
		ctx, apiresourcekind.ApiResourceKind_agent, annotationPath, projectID,
		func() proto.Message { return &agentv1.Agent{} },
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agents: %w", err)
	}
	agentMap := make(map[string]*agentv1.Agent)
	for _, r := range agents {
		if agent, ok := r.(*agentv1.Agent); ok {
			slug := s.resolveSlug(agent)
			if slug != "" {
				agentMap[slug] = agent
			}
		}
	}

	// Fetch workflows
	workflows, err := s.fetchResourcesByAnnotation(
		ctx, apiresourcekind.ApiResourceKind_workflow, annotationPath, projectID,
		func() proto.Message { return &workflowv1.Workflow{} },
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch workflows: %w", err)
	}
	workflowMap := make(map[string]*workflowv1.Workflow)
	for _, r := range workflows {
		if workflow, ok := r.(*workflowv1.Workflow); ok {
			slug := s.resolveSlug(workflow)
			if slug != "" {
				workflowMap[slug] = workflow
			}
		}
	}

	// Fetch MCP servers
	mcpServers, err := s.fetchResourcesByAnnotation(
		ctx, apiresourcekind.ApiResourceKind_mcp_server, annotationPath, projectID,
		func() proto.Message { return &mcpserverv1.McpServer{} },
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch MCP servers: %w", err)
	}
	mcpServerMap := make(map[string]*mcpserverv1.McpServer)
	for _, r := range mcpServers {
		if mcpServer, ok := r.(*mcpserverv1.McpServer); ok {
			slug := s.resolveSlug(mcpServer)
			if slug != "" {
				mcpServerMap[slug] = mcpServer
			}
		}
	}

	// Fetch skills
	skills, err := s.fetchResourcesByAnnotation(
		ctx, apiresourcekind.ApiResourceKind_skill, annotationPath, projectID,
		func() proto.Message { return &skillv1.Skill{} },
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch skills: %w", err)
	}
	skillMap := make(map[string]*skillv1.Skill)
	for _, r := range skills {
		if skill, ok := r.(*skillv1.Skill); ok {
			slug := s.resolveSlug(skill)
			if slug != "" {
				skillMap[slug] = skill
			}
		}
	}

	return NewActualState(agentMap, workflowMap, mcpServerMap, skillMap), nil
}

// fetchResourcesByAnnotation queries resources of a kind by annotation value.
func (s *reconciliationServiceImpl) fetchResourcesByAnnotation(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	fieldPath string,
	value string,
	newResource func() proto.Message,
) ([]proto.Message, error) {
	data, err := s.store.FindAllByField(ctx, kind, fieldPath, value)
	if err != nil {
		return nil, err
	}

	resources := make([]proto.Message, 0, len(data))
	for _, bytes := range data {
		resource := newResource()
		if err := proto.Unmarshal(bytes, resource); err != nil {
			// Skip resources that fail to unmarshal
			continue
		}
		resources = append(resources, resource)
	}

	return resources, nil
}

// planToResult converts a ReconciliationPlan to a ReconciliationResult.
//
// This is used for dry-run mode where the plan is computed but not executed.
// All changes are recorded as they would be in execution.
func (s *reconciliationServiceImpl) planToResult(plan *ReconciliationPlan) *ReconciliationResult {
	if plan == nil || plan.IsEmpty() {
		return EmptyResult()
	}

	var created, updated, deleted []*projectv1.ResourceChangeRecord

	for _, change := range plan.Creates() {
		created = append(created, s.changeToRecord(change))
	}
	for _, change := range plan.Updates() {
		updated = append(updated, s.changeToRecord(change))
	}
	for _, change := range plan.Deletes() {
		deleted = append(deleted, s.changeToRecord(change))
	}

	return NewSuccessResult(created, updated, deleted)
}

// changeToRecord converts a ResourceChange to a ResourceChangeRecord proto.
func (s *reconciliationServiceImpl) changeToRecord(change ResourceChange) *projectv1.ResourceChangeRecord {
	record := &projectv1.ResourceChangeRecord{
		Kind: change.Key().Kind(),
		Slug: change.Key().Slug(),
	}

	// Extract resource ID from actual state (for updates/deletes)
	if change.ActualState() != nil {
		if metadataResource, ok := change.ActualState().(steps.HasMetadata); ok {
			if metadata := metadataResource.GetMetadata(); metadata != nil {
				record.ResourceId = metadata.Id
			}
		}
	}

	return record
}

// filterDeletes returns a new plan with deletes removed.
//
// Used when prune is disabled to skip orphan deletion.
func (s *reconciliationServiceImpl) filterDeletes(plan *ReconciliationPlan) *ReconciliationPlan {
	if plan == nil {
		return EmptyPlan()
	}
	// Return new plan with empty deletes
	return NewReconciliationPlanWithGraph(
		plan.Creates(),
		plan.Updates(),
		nil, // No deletes
		plan.Graph(),
	)
}

// executePlan executes the reconciliation plan.
//
// Note: In D4, this is a stub implementation. The plan is computed but
// actual resource creation/update/deletion is deferred to Phase E2.
// This stub returns a result as if all changes succeeded.
func (s *reconciliationServiceImpl) executePlan(
	ctx context.Context,
	plan *ReconciliationPlan,
	projectID string,
) (*ReconciliationResult, error) {
	if plan == nil || plan.IsEmpty() {
		return EmptyResult(), nil
	}

	// D4 Stub: Return the plan as a success result without actual execution.
	// Full execution (calling downstream controllers) will be implemented in E2.
	//
	// The stub:
	// 1. Records all creates/updates/deletes as successful
	// 2. Does NOT actually create, update, or delete any resources
	// 3. Does NOT set ownership annotations on resources
	//
	// This allows testing the Apply handler flow end-to-end while
	// deferring the complex execution logic to Phase E2.

	return s.planToResult(plan), nil
}
