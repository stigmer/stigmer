package steps

import (
	"buf.build/go/protovalidate"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// ValidateProtoStep validates protobuf field constraints using protovalidate.
// This step ensures that the input message satisfies all validation rules
// defined in the proto file (e.g., required fields, min/max values, regex patterns).
//
// Field validation is also enforced at the transport boundary by the
// protovalidate interceptor, so on the gRPC path this step is a redundant
// (harmless) second check. It is retained deliberately because it is the ONLY
// validation on the direct-Go-call path — unit tests that call controllers
// directly rely on it — and both layers share one validator (SharedValidator),
// so the overlap costs nothing.
type ValidateProtoStep[T proto.Message] struct {
	validator protovalidate.Validator
}

// NewValidateProtoStep creates a new validation step backed by the process-wide
// shared validator (constraints are compiled once, not per request).
func NewValidateProtoStep[T proto.Message]() *ValidateProtoStep[T] {
	return &ValidateProtoStep[T]{validator: grpclib.SharedValidator()}
}

// Name returns the step name for logging and tracing.
func (s *ValidateProtoStep[T]) Name() string {
	return "ValidateProtoConstraints"
}

// Execute validates the input message against its proto validation rules.
func (s *ValidateProtoStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if err := s.validator.Validate(ctx.Input()); err != nil {
		return grpclib.InvalidArgumentError("%v", err)
	}
	return nil
}
