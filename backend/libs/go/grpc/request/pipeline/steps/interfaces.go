package steps

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// HasMetadata is an interface for resources that have ApiResourceMetadata
type HasMetadata interface {
	GetMetadata() *apiresource.ApiResourceMetadata
}

// getStatusField returns the status field from a proto message using reflection.
// Returns nil if the message doesn't have a "status" field.
//
// This approach is necessary because generated proto code returns concrete types
// (e.g., *AgentStatus) rather than proto.Message, which prevents interface-based
// type assertions from working.
func getStatusField(msg proto.Message) protoreflect.Message {
	if msg == nil {
		return nil
	}
	
	msgReflect := msg.ProtoReflect()
	statusField := msgReflect.Descriptor().Fields().ByName("status")
	if statusField == nil {
		return nil
	}
	
	// Check if status field is set (not nil)
	if !msgReflect.Has(statusField) {
		return nil
	}
	
	return msgReflect.Get(statusField).Message()
}

// getOrCreateStatusField returns the status field, creating it if necessary.
// Returns nil if the message doesn't have a "status" field.
func getOrCreateStatusField(msg proto.Message) protoreflect.Message {
	if msg == nil {
		return nil
	}
	
	msgReflect := msg.ProtoReflect()
	statusField := msgReflect.Descriptor().Fields().ByName("status")
	if statusField == nil {
		return nil
	}
	
	// If status is not set, create and set it
	if !msgReflect.Has(statusField) {
		// Create a new status message of the appropriate type
		newStatus := msgReflect.NewField(statusField)
		msgReflect.Set(statusField, newStatus)
	}
	
	return msgReflect.Get(statusField).Message()
}

// hasStatusField checks if a proto message has a "status" field in its schema.
func hasStatusField(msg proto.Message) bool {
	if msg == nil {
		return false
	}
	
	msgReflect := msg.ProtoReflect()
	statusField := msgReflect.Descriptor().Fields().ByName("status")
	return statusField != nil
}
