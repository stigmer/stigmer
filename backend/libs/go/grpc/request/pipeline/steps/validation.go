package steps

import (
	"fmt"

	"buf.build/go/protovalidate"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// ValidateProtoStep validates protobuf field constraints using protovalidate.
// This step ensures that the input message satisfies all validation rules
// defined in the proto file (e.g., required fields, min/max values, regex patterns).
type ValidateProtoStep[T proto.Message] struct {
	validator protovalidate.Validator
}

// NewValidateProtoStep creates a new validation step.
// Panics if the validator cannot be initialized (this is an initialization error, not a runtime error).
func NewValidateProtoStep[T proto.Message]() *ValidateProtoStep[T] {
	v, err := protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to create protovalidate validator: %v", err))
	}
	return &ValidateProtoStep[T]{validator: v}
}

// Name returns the step name for logging and tracing.
func (s *ValidateProtoStep[T]) Name() string {
	return "ValidateProtoConstraints"
}

// Execute validates the input message against its proto validation rules.
func (s *ValidateProtoStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if err := s.validator.Validate(ctx.Input()); err != nil {
		return grpclib.InvalidArgumentError(err.Error())
	}
	return nil
}
