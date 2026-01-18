package steps

import (
	"fmt"

	"buf.build/go/protovalidate"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
	"google.golang.org/protobuf/proto"
)

// ValidateProtoStep validates protobuf field constraints using protovalidate.
// This step ensures that the input message satisfies all validation rules
// defined in the proto file (e.g., required fields, min/max values, regex patterns).
type ValidateProtoStep[T proto.Message] struct {
	validator protovalidate.Validator
}

// NewValidateProtoStep creates a new validation step.
// Returns an error if the validator cannot be initialized.
func NewValidateProtoStep[T proto.Message]() (*ValidateProtoStep[T], error) {
	v, err := protovalidate.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create protovalidate validator: %w", err)
	}
	return &ValidateProtoStep[T]{validator: v}, nil
}

// Name returns the step name for logging and tracing.
func (s *ValidateProtoStep[T]) Name() string {
	return "ValidateProtoConstraints"
}

// Execute validates the input message against its proto validation rules.
func (s *ValidateProtoStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	if err := s.validator.Validate(ctx.Input()); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}
	return nil
}
