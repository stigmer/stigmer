package steps

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/types/known/emptypb"
)

func TestNewValidateProtoStep(t *testing.T) {
	step := NewValidateProtoStep[*emptypb.Empty]()

	if step == nil {
		t.Error("expected non-nil step")
	}

	if step.Name() != "ValidateProtoConstraints" {
		t.Errorf("expected step name 'ValidateProtoConstraints', got '%s'", step.Name())
	}
}

func TestValidateProtoStepExecute(t *testing.T) {
	step := NewValidateProtoStep[*emptypb.Empty]()

	tests := []struct {
		name    string
		input   *emptypb.Empty
		wantErr bool
	}{
		{
			name:    "valid empty message",
			input:   &emptypb.Empty{},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := pipeline.NewRequestContext(context.Background(), tt.input)
			err := step.Execute(ctx)

			if tt.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("expected no error, got %v", err)
			}
		})
	}
}

func TestValidateProtoStepIntegration(t *testing.T) {
	// Build a simple pipeline with validation step
	p := pipeline.NewPipeline[*emptypb.Empty]("test-validation").
		AddStep(NewValidateProtoStep[*emptypb.Empty]()).
		Build()

	// Execute pipeline
	ctx := pipeline.NewRequestContext(context.Background(), &emptypb.Empty{})
	err := p.Execute(ctx)

	if err != nil {
		t.Errorf("pipeline execution failed: %v", err)
	}
}
