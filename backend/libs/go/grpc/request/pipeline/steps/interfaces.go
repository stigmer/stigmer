package steps

import (
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
)

// HasMetadata is an interface for resources that have ApiResourceMetadata
type HasMetadata interface {
	GetMetadata() *apiresource.ApiResourceMetadata
}

// HasStatus is an interface for resources that have a status field
//
// The status must be a proto.Message so we can use reflection to set audit fields.
type HasStatus interface {
	proto.Message
	GetStatus() proto.Message
}
