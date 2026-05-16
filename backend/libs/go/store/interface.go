// Package store defines the common interface for resource storage implementations.
// This abstraction layer enables future backend swaps (SQLite, memory, etc.)
// without touching consumers.
package store

import (
	"context"
	"errors"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// ErrNotFound is returned when a resource does not exist in the store.
// Consumers should use errors.Is(err, store.ErrNotFound) for checking.
var ErrNotFound = errors.New("resource not found")

// ErrAuditNotFound is returned when an audit record does not exist.
// Consumers should use errors.Is(err, store.ErrAuditNotFound) for checking.
var ErrAuditNotFound = errors.New("audit record not found")

// Store defines the contract for resource persistence.
// All storage implementations (SQLite, memory) must satisfy this interface.
//
// The store provides two distinct storage areas:
//   - Resources: Live/current state of resources (SaveResource, GetResource, etc.)
//   - Audit: Immutable version history snapshots (SaveAudit, GetAuditByHash, etc.)
//
// When a resource is deleted, its associated audit records are automatically
// cleaned up via CASCADE DELETE in the underlying storage.
type Store interface {
	// ===========================================================================
	// Resource Operations (Live/Current State)
	// ===========================================================================

	// SaveResource persists a proto message to the store.
	// If a resource with the same kind+id exists, it will be overwritten.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - id: unique resource identifier within the kind
	//   - msg: the proto message to save (will be marshaled to bytes)
	SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error

	// GetResource retrieves a resource by kind and ID.
	// Returns ErrNotFound if the resource does not exist.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - id: unique resource identifier
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error

	// UpdateResource performs an atomic read-modify-write on a resource.
	//
	// The store reads the resource into msg, calls modify (which should mutate
	// msg in place), then persists the modified message. The entire operation
	// is serialized against concurrent writes so that two concurrent updates
	// to the same resource never overwrite each other's changes.
	//
	// Returns ErrNotFound if the resource does not exist.
	// If modify returns an error, the write is skipped and that error is returned.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent_execution)
	//   - id: unique resource identifier
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	//   - modify: function that mutates msg; called exactly once under the write lock
	UpdateResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message, modify func() error) error

	// ListResources retrieves all resources of a given kind.
	// Returns an empty slice (not nil) if no resources exist.
	//
	// Note: This returns only live resources, not audit records.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//
	// Returns: slice of marshaled protobuf bytes (one per resource)
	ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)

	// DeleteResource removes a resource by kind and ID.
	// Returns nil (no error) if the resource does not exist.
	//
	// Note: Associated audit records are automatically deleted via CASCADE.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - id: unique resource identifier
	DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error

	// FindByField retrieves a single resource by matching a specific JSON field value.
	// This enables queries like "find ExecutionContext where spec.executionId = X".
	// Returns ErrNotFound if no resource exists with the matching field value.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_execution_context)
	//   - fieldPath: JSON field path using dot notation (e.g., "spec.executionId")
	//   - value: the value to match
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	//
	// Note: This performs a full table scan for the given kind. For frequently
	// queried fields, consider adding a dedicated index in the store implementation.
	FindByField(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string, msg proto.Message) error

	// FindAllByField retrieves all resources matching a specific JSON field value.
	// This enables queries like "find all WorkflowExecutions where spec.workflowInstanceId = X".
	// Returns an empty slice (not nil) if no resources match.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_workflow_execution)
	//   - fieldPath: JSON field path using dot notation (e.g., "spec.workflowInstanceId")
	//   - value: the value to match
	//
	// Returns: slice of marshaled protobuf bytes (one per matching resource)
	FindAllByField(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string) ([][]byte, error)

	// FindByLabel retrieves a single resource matching a metadata label key-value pair.
	// This enables queries like "find the Agent with stigmer.ai/default-agent=true".
	// Returns ErrNotFound if no resource matches.
	//
	// Labels are stored in metadata.labels (map<string, string>) on all API resources.
	// Unlike FindByField, this method handles map fields correctly and avoids
	// ambiguity with dot-separated label keys (e.g., "stigmer.ai/default-agent").
	//
	// If multiple resources match, the first match is returned. Use FindAllByLabel
	// when the caller needs to enforce uniqueness constraints.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - labelKey: the label key to match (e.g., "stigmer.ai/default-agent")
	//   - labelValue: the label value to match (e.g., "true")
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	//
	// Note: This performs a full table scan for the given kind. For frequently
	// queried labels, consider adding a dedicated index in the store implementation.
	FindByLabel(ctx context.Context, kind apiresourcekind.ApiResourceKind, labelKey, labelValue string, msg proto.Message) error

	// FindAllByLabel retrieves all resources matching a metadata label key-value pair.
	// Returns an empty slice (not nil) if no resources match.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - labelKey: the label key to match (e.g., "stigmer.ai/system")
	//   - labelValue: the label value to match (e.g., "true")
	//   - templateMsg: a zero-value proto message of the target type, used as a
	//     deserialization template for label extraction (not modified)
	//
	// Returns: slice of marshaled protobuf bytes (one per matching resource)
	FindAllByLabel(ctx context.Context, kind apiresourcekind.ApiResourceKind, labelKey, labelValue string, templateMsg proto.Message) ([][]byte, error)

	// DeleteResourcesByKind removes all resources of a given kind.
	// Useful for bulk cleanup operations (e.g., "stigmer local clean --kind=Agent").
	//
	// Note: Associated audit records are automatically deleted via CASCADE.
	//
	// Parameters:
	//   - kind: resource kind enum
	//
	// Returns: number of resources deleted
	DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error)

	// DeleteResourcesByIdPrefix removes all resources of a given kind whose ID
	// starts with the specified prefix.
	//
	// Deprecated: This method exists for backward compatibility with legacy prefix-based
	// key patterns. New code should use the audit-specific methods instead.
	// This will be removed in a future version.
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - idPrefix: prefix to match (e.g., "agent-123" matches "agent-123/1706123456")
	//
	// Returns: number of resources deleted
	DeleteResourcesByIdPrefix(ctx context.Context, kind apiresourcekind.ApiResourceKind, idPrefix string) (int64, error)

	// ===========================================================================
	// Audit Operations (Version History)
	// ===========================================================================

	// SaveAudit archives an immutable snapshot of a resource for version history.
	// Each call creates a new audit record with a unique auto-incremented ID.
	//
	// The versionHash and tag parameters are stored as indexed columns for
	// efficient queries. These should be extracted from the proto message
	// before calling this method.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_skill)
	//   - resourceId: ID of the parent resource (must exist in resources table)
	//   - msg: the proto message snapshot to archive (will be marshaled to bytes)
	//   - versionHash: SHA256 hash of the content (for exact version lookup)
	//   - tag: version tag/label (for tag-based lookup, may be empty)
	SaveAudit(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, msg proto.Message, versionHash, tag string) error

	// GetAuditByHash retrieves an archived version by exact hash match.
	// Returns ErrAuditNotFound if no audit record exists with the given hash.
	//
	// This is useful for content-addressed lookups where the exact version
	// is known (e.g., "get skill version with hash abc123...").
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - resourceId: ID of the parent resource
	//   - versionHash: SHA256 hash to match
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	GetAuditByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash string, msg proto.Message) error

	// GetAuditByTag retrieves the most recent archived version with matching tag.
	// Returns ErrAuditNotFound if no audit record exists with the given tag.
	//
	// When multiple audit records have the same tag (e.g., after re-tagging),
	// the most recent one (by archived_at timestamp) is returned.
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - resourceId: ID of the parent resource
	//   - tag: version tag to match
	//   - msg: pointer to proto message to unmarshal into (must be initialized)
	GetAuditByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, tag string, msg proto.Message) error

	// ListAuditHistory retrieves all archived versions for a resource.
	// Returns newest first (sorted by archived_at DESC).
	// Returns an empty slice (not nil) if no audit records exist.
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - resourceId: ID of the parent resource
	//
	// Returns: slice of marshaled protobuf bytes (one per audit record)
	ListAuditHistory(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) ([][]byte, error)

	// DeleteAuditByResourceId removes all audit records for a resource.
	//
	// Note: This is typically not needed since audit records are automatically
	// deleted when the parent resource is deleted (CASCADE DELETE). This method
	// exists for explicit cleanup scenarios like pruning old versions.
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - resourceId: ID of the parent resource
	//
	// Returns: number of audit records deleted
	DeleteAuditByResourceId(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) (int64, error)

	// ===========================================================================
	// Workflow Execution Event Operations
	// ===========================================================================

	// AppendWorkflowExecutionEvents appends events to the execution's event log.
	// Enforces monotonically increasing sequence_numbers — rejects the batch
	// if any event's sequence_number is <= the current highest persisted sequence.
	// Returns the number of events appended.
	AppendWorkflowExecutionEvents(ctx context.Context, executionID string, events []*WorkflowExecutionEventRecord) (int, error)

	// GetWorkflowExecutionEvents retrieves events for an execution with cursor-based pagination.
	// afterSequence: return events with sequence_number > afterSequence (0 for all)
	// eventType: filter by type (empty for all)
	// taskName: filter by task name (empty for all)
	// limit: max events to return (0 for default of 100)
	GetWorkflowExecutionEvents(ctx context.Context, executionID string, afterSequence int64, eventType string, taskName string, limit int) ([]*WorkflowExecutionEventRecord, error)

	// GetMaxEventSequence returns the highest sequence_number for an execution.
	// Returns 0 if no events exist.
	GetMaxEventSequence(ctx context.Context, executionID string) (int64, error)

	// ===========================================================================
	// Search Index Operations (Full-Text Search)
	// ===========================================================================

	// UpsertSearchIndex inserts or updates a search index entry for a resource.
	// This enables full-text search across resources using FTS5.
	//
	// The search index is separate from the main resources table and must be
	// explicitly updated when resources are created/modified. This separation
	// allows for flexible indexing strategies and avoids coupling the main
	// store with search-specific concerns.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - resourceId: unique resource identifier
	//   - entry: searchable fields extracted from the resource
	UpsertSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, entry *SearchIndexEntry) error

	// DeleteSearchIndex removes a search index entry for a resource.
	// Should be called when a resource is deleted.
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - resourceId: unique resource identifier
	DeleteSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) error

	// ===========================================================================
	// Lifecycle
	// ===========================================================================

	// Close releases all resources held by the store.
	// After Close is called, all other methods will return errors.
	Close() error
}

// WorkflowExecutionEventRecord is the storage representation of a workflow execution event.
type WorkflowExecutionEventRecord struct {
	ExecutionID    string
	SequenceNumber int64
	EventType      string
	TaskName       string
	Data           []byte // protobuf-serialized WorkflowExecutionEvent
	CreatedAt      string
}

// SearchIndexEntry contains the searchable fields extracted from a resource.
// These fields are stored in the FTS5 index for full-text search.
type SearchIndexEntry struct {
	// Name is the human-readable display name (from metadata.name).
	// This field has the highest search weight.
	Name string

	// Description is the resource description for search results.
	// Varies by resource type:
	//   - Agent: spec.instructions or spec.description
	//   - Skill, McpServer, Workflow: spec.description
	Description string

	// Tags are space-separated tags for categorization (from metadata.tags).
	// Stored as a single string for FTS5 indexing.
	Tags string

	// Org is the organization that owns this resource (from metadata.org).
	// Used for org-scoped filtering.
	Org string

	// Visibility is the resource visibility ("visibility_public" or "visibility_private").
	// Used for filtering public/private resources.
	Visibility string

	// CreatedAt is the Unix timestamp (seconds) when the resource was created.
	// Used for sorting in list mode (no query).
	CreatedAt int64
}
