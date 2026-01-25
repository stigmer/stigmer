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
	// Deprecated: This method exists for backward compatibility with BadgerDB-style
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
	// Lifecycle
	// ===========================================================================

	// Close releases all resources held by the store.
	// After Close is called, all other methods will return errors.
	Close() error
}
