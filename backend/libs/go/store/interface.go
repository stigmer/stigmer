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

// Store defines the contract for resource persistence.
// All storage implementations (SQLite, BadgerDB, memory) must satisfy this interface.
type Store interface {
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
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//
	// Returns: slice of marshaled protobuf bytes (one per resource)
	ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)

	// DeleteResource removes a resource by kind and ID.
	// Returns nil (no error) if the resource does not exist.
	//
	// Parameters:
	//   - kind: resource kind enum (e.g., ApiResourceKind_agent)
	//   - id: unique resource identifier
	DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error

	// DeleteResourcesByKind removes all resources of a given kind.
	// Useful for bulk cleanup operations (e.g., "stigmer local clean --kind=Agent").
	//
	// Parameters:
	//   - kind: resource kind enum
	//
	// Returns: number of resources deleted
	DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error)

	// DeleteResourcesByIdPrefix removes all resources of a given kind whose ID
	// starts with the specified prefix. This is useful for deleting audit/archive
	// records keyed as "<resource_id>/<timestamp>".
	//
	// Parameters:
	//   - kind: resource kind enum
	//   - idPrefix: prefix to match (e.g., "agent-123" matches "agent-123/1706123456")
	//
	// Returns: number of resources deleted
	DeleteResourcesByIdPrefix(ctx context.Context, kind apiresourcekind.ApiResourceKind, idPrefix string) (int64, error)

	// Close releases all resources held by the store.
	// After Close is called, all other methods will return errors.
	Close() error
}
