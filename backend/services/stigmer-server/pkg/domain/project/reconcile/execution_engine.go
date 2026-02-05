// Package reconcile provides the reconciliation engine for Project resources.
package reconcile

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/protobuf/proto"
)

// ResourceController defines the interface for downstream resource operations.
//
// This interface abstracts the downstream clients (Agent, Workflow, McpServer, Skill)
// to enable dependency injection and testability. The ExecutionEngine uses this
// interface to create, update, and delete resources during reconciliation.
//
// Each method corresponds to a gRPC controller operation on the downstream service.
// All operations go through the full gRPC interceptor chain (validation, logging, etc.).
type ResourceController interface {
	// Agent operations
	CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	UpdateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	DeleteAgent(ctx context.Context, id string) error

	// Workflow operations
	CreateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	UpdateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	DeleteWorkflow(ctx context.Context, id string) error

	// McpServer operations
	CreateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	UpdateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	DeleteMcpServer(ctx context.Context, id string) error

	// Skill operations - uses Push for both create and update (idempotent)
	PushSkill(ctx context.Context, skill *skillv1.Skill) (*skillv1.Skill, error)
	DeleteSkill(ctx context.Context, id string) error
}

// ExecutionEngine executes reconciliation plans against downstream controllers.
//
// The ExecutionEngine is responsible for:
//   - Executing creates/updates in topological order (dependencies first)
//   - Executing deletes in reverse topological order (dependents first)
//   - Preparing resources with ownership annotations
//   - Handling partial failures (continue on error)
//   - Building the reconciliation result
//
// Example:
//
//	engine := NewExecutionEngine(controllers)
//	result := engine.ExecutePlan(ctx, plan, projectID, projectOrg)
type ExecutionEngine struct {
	controllers ResourceController
}

// NewExecutionEngine creates a new ExecutionEngine with the given controllers.
func NewExecutionEngine(controllers ResourceController) *ExecutionEngine {
	return &ExecutionEngine{
		controllers: controllers,
	}
}

// ExecutePlan executes a reconciliation plan and returns the result.
//
// The method:
//  1. Executes creates and updates in topological order (dependencies first)
//  2. Executes deletes in reverse topological order (dependents first)
//  3. Continues on error (partial failure handling)
//  4. Returns a result with successes and errors
//
// Parameters:
//   - ctx: Context for cancellation and deadline propagation
//   - plan: The computed reconciliation plan
//   - projectID: ID of the project (for ownership annotation)
//   - projectOrg: Org of the project (for resource metadata)
func (e *ExecutionEngine) ExecutePlan(
	ctx context.Context,
	plan *ReconciliationPlan,
	projectID string,
	projectOrg string,
) *ReconciliationResult {
	if plan == nil || plan.IsEmpty() {
		return EmptyResult()
	}

	builder := NewResultBuilder()

	// Execute creates and updates in dependency order
	e.executeCreatesAndUpdates(ctx, plan, projectID, projectOrg, builder)

	// Execute deletes in reverse dependency order
	e.executeDeletes(ctx, plan, builder)

	return builder.Build()
}

// executeCreatesAndUpdates executes create and update operations in topological order.
func (e *ExecutionEngine) executeCreatesAndUpdates(
	ctx context.Context,
	plan *ReconciliationPlan,
	projectID string,
	projectOrg string,
	builder *ResultBuilder,
) {
	for _, change := range plan.GetChangesInExecutionOrder() {
		record, err := e.executeCreateOrUpdate(ctx, change, projectID, projectOrg)
		if err != nil {
			builder.AddError(NewReconciliationErrorWithCause(
				change.Key().String(),
				fmt.Sprintf("failed to %s", change.ChangeType()),
				err,
			))
			continue
		}
		e.recordSuccess(builder, change, record)
	}
}

// executeDeletes executes delete operations in reverse topological order.
func (e *ExecutionEngine) executeDeletes(
	ctx context.Context,
	plan *ReconciliationPlan,
	builder *ResultBuilder,
) {
	for _, change := range plan.GetDeletesInReverseDependencyOrder() {
		record, err := e.executeDelete(ctx, change)
		if err != nil {
			builder.AddError(NewReconciliationErrorWithCause(
				change.Key().String(),
				"failed to delete",
				err,
			))
			continue
		}
		builder.AddDeleted(record)
	}
}

// executeCreateOrUpdate executes a single create or update operation.
func (e *ExecutionEngine) executeCreateOrUpdate(
	ctx context.Context,
	change ResourceChange,
	projectID string,
	projectOrg string,
) (*projectv1.ResourceChangeRecord, error) {
	kind := change.Key().Kind()

	if change.IsCreate() {
		return e.executeCreate(ctx, change, projectID, projectOrg, kind)
	}
	return e.executeUpdate(ctx, change, projectID, kind)
}

// executeCreate prepares and creates a new resource.
func (e *ExecutionEngine) executeCreate(
	ctx context.Context,
	change ResourceChange,
	projectID string,
	projectOrg string,
	kind apiresourcekind.ApiResourceKind,
) (*projectv1.ResourceChangeRecord, error) {
	prepared, err := e.prepareForCreate(change.DesiredState(), projectID, projectOrg)
	if err != nil {
		return nil, fmt.Errorf("prepare for create: %w", err)
	}

	created, err := e.createResource(ctx, kind, prepared)
	if err != nil {
		return nil, err
	}

	return e.buildChangeRecord(change.Key(), created), nil
}

// executeUpdate prepares and updates an existing resource.
func (e *ExecutionEngine) executeUpdate(
	ctx context.Context,
	change ResourceChange,
	projectID string,
	kind apiresourcekind.ApiResourceKind,
) (*projectv1.ResourceChangeRecord, error) {
	prepared, err := e.prepareForUpdate(change.DesiredState(), change.ActualState(), projectID)
	if err != nil {
		return nil, fmt.Errorf("prepare for update: %w", err)
	}

	updated, err := e.updateResource(ctx, kind, prepared)
	if err != nil {
		return nil, err
	}

	return e.buildChangeRecord(change.Key(), updated), nil
}

// executeDelete deletes a resource.
func (e *ExecutionEngine) executeDelete(
	ctx context.Context,
	change ResourceChange,
) (*projectv1.ResourceChangeRecord, error) {
	resourceID, err := extractResourceID(change.ActualState())
	if err != nil {
		return nil, fmt.Errorf("extract resource ID: %w", err)
	}

	kind := change.Key().Kind()
	if err := e.deleteResource(ctx, kind, resourceID); err != nil {
		return nil, err
	}

	return e.buildChangeRecordWithID(change.Key(), resourceID), nil
}

// createResource routes to the appropriate controller create method.
func (e *ExecutionEngine) createResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	resource proto.Message,
) (proto.Message, error) {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent:
		return e.controllers.CreateAgent(ctx, resource.(*agentv1.Agent))
	case apiresourcekind.ApiResourceKind_workflow:
		return e.controllers.CreateWorkflow(ctx, resource.(*workflowv1.Workflow))
	case apiresourcekind.ApiResourceKind_mcp_server:
		return e.controllers.CreateMcpServer(ctx, resource.(*mcpserverv1.McpServer))
	case apiresourcekind.ApiResourceKind_skill:
		return e.controllers.PushSkill(ctx, resource.(*skillv1.Skill))
	default:
		return nil, fmt.Errorf("unsupported kind for create: %v", kind)
	}
}

// updateResource routes to the appropriate controller update method.
func (e *ExecutionEngine) updateResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	resource proto.Message,
) (proto.Message, error) {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent:
		return e.controllers.UpdateAgent(ctx, resource.(*agentv1.Agent))
	case apiresourcekind.ApiResourceKind_workflow:
		return e.controllers.UpdateWorkflow(ctx, resource.(*workflowv1.Workflow))
	case apiresourcekind.ApiResourceKind_mcp_server:
		return e.controllers.UpdateMcpServer(ctx, resource.(*mcpserverv1.McpServer))
	case apiresourcekind.ApiResourceKind_skill:
		return e.controllers.PushSkill(ctx, resource.(*skillv1.Skill))
	default:
		return nil, fmt.Errorf("unsupported kind for update: %v", kind)
	}
}

// deleteResource routes to the appropriate controller delete method.
func (e *ExecutionEngine) deleteResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	resourceID string,
) error {
	switch kind {
	case apiresourcekind.ApiResourceKind_agent:
		return e.controllers.DeleteAgent(ctx, resourceID)
	case apiresourcekind.ApiResourceKind_workflow:
		return e.controllers.DeleteWorkflow(ctx, resourceID)
	case apiresourcekind.ApiResourceKind_mcp_server:
		return e.controllers.DeleteMcpServer(ctx, resourceID)
	case apiresourcekind.ApiResourceKind_skill:
		return e.controllers.DeleteSkill(ctx, resourceID)
	default:
		return fmt.Errorf("unsupported kind for delete: %v", kind)
	}
}

// prepareForCreate prepares a resource for creation.
//
// This sets:
//   - Ownership annotation (stigmer.ai/sdk.project = projectID)
//   - Organization from project
//   - Ensures api_version and kind are set
func (e *ExecutionEngine) prepareForCreate(
	desired proto.Message,
	projectID string,
	projectOrg string,
) (proto.Message, error) {
	// Clone to avoid mutating the original
	cloned := proto.Clone(desired)

	metaResource, ok := cloned.(steps.HasMetadata)
	if !ok {
		return nil, fmt.Errorf("resource does not have metadata")
	}

	metadata := metaResource.GetMetadata()
	if metadata == nil {
		return nil, fmt.Errorf("resource metadata is nil")
	}

	// Set org from project
	metadata.Org = projectOrg

	// Set ownership annotation
	if metadata.Annotations == nil {
		metadata.Annotations = make(map[string]string)
	}
	metadata.Annotations[ProjectOwnershipAnnotation] = projectID

	return cloned, nil
}

// prepareForUpdate prepares a resource for update.
//
// This:
//   - Preserves ID, slug, org from actual state
//   - Uses spec from desired state
//   - Sets ownership annotation
func (e *ExecutionEngine) prepareForUpdate(
	desired proto.Message,
	actual proto.Message,
	projectID string,
) (proto.Message, error) {
	// Clone desired to avoid mutating the original
	cloned := proto.Clone(desired)

	desiredMeta, ok := cloned.(steps.HasMetadata)
	if !ok {
		return nil, fmt.Errorf("desired resource does not have metadata")
	}
	actualMeta, ok := actual.(steps.HasMetadata)
	if !ok {
		return nil, fmt.Errorf("actual resource does not have metadata")
	}

	desiredMetadata := desiredMeta.GetMetadata()
	actualMetadata := actualMeta.GetMetadata()

	if desiredMetadata == nil || actualMetadata == nil {
		return nil, fmt.Errorf("resource metadata is nil")
	}

	// Preserve immutable fields from actual state
	desiredMetadata.Id = actualMetadata.Id
	desiredMetadata.Slug = actualMetadata.Slug
	desiredMetadata.Org = actualMetadata.Org

	// Set ownership annotation
	if desiredMetadata.Annotations == nil {
		desiredMetadata.Annotations = make(map[string]string)
	}
	desiredMetadata.Annotations[ProjectOwnershipAnnotation] = projectID

	return cloned, nil
}

// recordSuccess records a successful create or update operation.
func (e *ExecutionEngine) recordSuccess(
	builder *ResultBuilder,
	change ResourceChange,
	record *projectv1.ResourceChangeRecord,
) {
	if change.IsCreate() {
		builder.AddCreated(record)
	} else {
		builder.AddUpdated(record)
	}
}

// buildChangeRecord creates a ResourceChangeRecord from a change and result.
func (e *ExecutionEngine) buildChangeRecord(
	key ResourceKey,
	result proto.Message,
) *projectv1.ResourceChangeRecord {
	record := &projectv1.ResourceChangeRecord{
		Kind: key.Kind(),
		Slug: key.Slug(),
	}

	if metaResource, ok := result.(steps.HasMetadata); ok {
		if metadata := metaResource.GetMetadata(); metadata != nil {
			record.ResourceId = metadata.Id
		}
	}

	return record
}

// buildChangeRecordWithID creates a ResourceChangeRecord with an explicit ID.
func (e *ExecutionEngine) buildChangeRecordWithID(
	key ResourceKey,
	resourceID string,
) *projectv1.ResourceChangeRecord {
	return &projectv1.ResourceChangeRecord{
		Kind:       key.Kind(),
		Slug:       key.Slug(),
		ResourceId: resourceID,
	}
}

// extractResourceID extracts the resource ID from a proto message.
func extractResourceID(resource proto.Message) (string, error) {
	if resource == nil {
		return "", fmt.Errorf("resource is nil")
	}

	metaResource, ok := resource.(steps.HasMetadata)
	if !ok {
		return "", fmt.Errorf("resource does not have metadata")
	}

	metadata := metaResource.GetMetadata()
	if metadata == nil {
		return "", fmt.Errorf("resource metadata is nil")
	}

	if metadata.Id == "" {
		return "", fmt.Errorf("resource ID is empty")
	}

	return metadata.Id, nil
}

// =============================================================================
// ResourceControllerAdapter - Wraps downstream clients to implement interface
// =============================================================================

// DownstreamClients holds references to all downstream resource clients.
type DownstreamClients struct {
	AgentClient     AgentClient
	WorkflowClient  WorkflowClient
	McpServerClient McpServerClient
	SkillClient     SkillClient
}

// AgentClient defines the agent operations needed by the execution engine.
type AgentClient interface {
	Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
	Delete(ctx context.Context, resourceID string) (*agentv1.Agent, error)
}

// WorkflowClient defines the workflow operations needed by the execution engine.
type WorkflowClient interface {
	Create(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error)
	Delete(ctx context.Context, resourceID string) (*workflowv1.Workflow, error)
}

// McpServerClient defines the MCP server operations needed by the execution engine.
type McpServerClient interface {
	Create(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	Update(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
	Delete(ctx context.Context, resourceID string) (*mcpserverv1.McpServer, error)
}

// SkillClient defines the skill operations needed by the execution engine.
// Note: Skill uses Push for both create and update.
type SkillClient interface {
	Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error)
	Delete(ctx context.Context, resourceID string) (*skillv1.Skill, error)
}

// ResourceControllerAdapter adapts DownstreamClients to the ResourceController interface.
type ResourceControllerAdapter struct {
	clients *DownstreamClients
}

// NewResourceControllerAdapter creates a new adapter from downstream clients.
func NewResourceControllerAdapter(clients *DownstreamClients) *ResourceControllerAdapter {
	return &ResourceControllerAdapter{clients: clients}
}

// Agent operations

func (a *ResourceControllerAdapter) CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	return a.clients.AgentClient.Create(ctx, agent)
}

func (a *ResourceControllerAdapter) UpdateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	return a.clients.AgentClient.Update(ctx, agent)
}

func (a *ResourceControllerAdapter) DeleteAgent(ctx context.Context, id string) error {
	_, err := a.clients.AgentClient.Delete(ctx, id)
	return err
}

// Workflow operations

func (a *ResourceControllerAdapter) CreateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return a.clients.WorkflowClient.Create(ctx, workflow)
}

func (a *ResourceControllerAdapter) UpdateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return a.clients.WorkflowClient.Update(ctx, workflow)
}

func (a *ResourceControllerAdapter) DeleteWorkflow(ctx context.Context, id string) error {
	_, err := a.clients.WorkflowClient.Delete(ctx, id)
	return err
}

// McpServer operations

func (a *ResourceControllerAdapter) CreateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	return a.clients.McpServerClient.Create(ctx, server)
}

func (a *ResourceControllerAdapter) UpdateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	return a.clients.McpServerClient.Update(ctx, server)
}

func (a *ResourceControllerAdapter) DeleteMcpServer(ctx context.Context, id string) error {
	_, err := a.clients.McpServerClient.Delete(ctx, id)
	return err
}

// Skill operations

func (a *ResourceControllerAdapter) PushSkill(ctx context.Context, skill *skillv1.Skill) (*skillv1.Skill, error) {
	// Convert Skill to PushSkillRequest
	// Note: For reconciliation, we don't have the artifact bytes, so we need
	// a different approach. Skills in Project.Spec should reference existing skills
	// by slug, not define new ones with artifacts.
	//
	// For now, return an error indicating skills cannot be created via reconciliation.
	// Skills must be pushed separately via `stigmer skill push`.
	return nil, fmt.Errorf("skills cannot be created/updated via project reconciliation; use 'stigmer skill push' instead")
}

func (a *ResourceControllerAdapter) DeleteSkill(ctx context.Context, id string) error {
	_, err := a.clients.SkillClient.Delete(ctx, id)
	return err
}

// =============================================================================
// Helper to get project org from proto
// =============================================================================

// GetProjectOrg extracts the org from a Project's metadata.
func GetProjectOrg(project interface{ GetMetadata() *apiresource.ApiResourceMetadata }) string {
	if project == nil {
		return ""
	}
	metadata := project.GetMetadata()
	if metadata == nil {
		return ""
	}
	return metadata.Org
}
