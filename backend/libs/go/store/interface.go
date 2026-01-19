// Package store defines the common interface for resource storage implementations.
// This allows pipeline steps to work with any storage backend (BadgerDB, etc.)
package store

import (
	"context"

	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// Store is the interface that all storage implementations must implement
// Uses type-safe ApiResourceKind enum for kind parameter
type Store interface {
	// SaveResource saves a proto message to the store
	// kind: resource kind enum (e.g., ApiResourceKind_agent)
	// id: unique resource identifier
	// msg: the proto message to save
	SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error

	// GetResource retrieves a resource by kind and ID and unmarshals into the provided proto message
	// kind: resource kind enum (e.g., ApiResourceKind_agent)
	// id: unique resource identifier
	// msg: pointer to proto message to unmarshal into
	GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error

	// ListResources retrieves all resources of a given kind
	// kind: resource kind enum (e.g., ApiResourceKind_agent)
	// Returns: slice of proto bytes (marshaled protobuf messages)
	ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)

	// DeleteResource deletes a resource by kind and ID
	// kind: resource kind enum (e.g., ApiResourceKind_agent)
	// id: unique resource identifier
	DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error

	// DeleteResourcesByKind deletes all resources of a given kind
	// kind: resource kind enum
	// Returns: number of resources deleted
	DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error)

	// Close closes the store connection
	Close() error
}
