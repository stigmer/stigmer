package steps

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
	"google.golang.org/protobuf/types/known/emptypb"
)

func TestNewValidateProtoStep(t *testing.T) {
	step, err := NewValidateProtoStep[*emptypb.Empty]()
	if err != nil {
		t.Fatalf("failed to create validation step: %v", err)
	}

	if step == nil {
		t.Error("expected non-nil step")
	}

	if step.Name() != "ValidateProtoConstraints" {
		t.Errorf("expected step name 'ValidateProtoConstraints', got '%s'", step.Name())
	}
}

func TestValidateProtoStepExecute(t *testing.T) {
	step, err := NewValidateProtoStep[*emptypb.Empty]()
	if err != nil {
		t.Fatalf("failed to create validation step: %v", err)
	}

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
	// Create validation step
	validateStep, err := NewValidateProtoStep[*emptypb.Empty]()
	if err != nil {
		t.Fatalf("failed to create validation step: %v", err)
	}

	// Build a simple pipeline
	p := pipeline.NewPipeline[*emptypb.Empty]("test-validation").
		AddStep(validateStep).
		Build()

	// Execute pipeline
	ctx := pipeline.NewRequestContext(context.Background(), &emptypb.Empty{})
	err = p.Execute(ctx)

	if err != nil {
		t.Errorf("pipeline execution failed: %v", err)
	}
}
