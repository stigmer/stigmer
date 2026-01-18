// Package store defines the common interface for resource storage implementations.
// This allows pipeline steps to work with any storage backend (SQLite, BadgerDB, etc.)
package store

import (
	"context"

	"google.golang.org/protobuf/proto"
)

// Store is the interface that all storage implementations must implement
type Store interface {
	// SaveResource saves a proto message to the store
	// kind: resource kind (e.g., "Agent", "Workflow")
	// id: unique resource identifier
	// msg: the proto message to save
	SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error

	// GetResource retrieves a resource by ID and unmarshals into the provided proto message
	// id: unique resource identifier
	// msg: pointer to proto message to unmarshal into
	GetResource(ctx context.Context, id string, msg proto.Message) error

	// ListResources retrieves all resources of a given kind
	// kind: resource kind (e.g., "Agent", "Workflow")
	// Returns: slice of proto bytes (marshaled protobuf messages)
	ListResources(ctx context.Context, kind string) ([][]byte, error)

	// ListResourcesByOrg retrieves all resources of a given kind for an organization
	// kind: resource kind
	// orgID: organization identifier
	// Returns: slice of proto bytes (marshaled protobuf messages)
	ListResourcesByOrg(ctx context.Context, kind string, orgID string) ([][]byte, error)

	// DeleteResource deletes a resource by ID
	// id: unique resource identifier
	DeleteResource(ctx context.Context, id string) error

	// DeleteResourcesByKind deletes all resources of a given kind
	// kind: resource kind
	// Returns: number of resources deleted
	DeleteResourcesByKind(ctx context.Context, kind string) (int64, error)

	// Close closes the store connection
	Close() error
}
