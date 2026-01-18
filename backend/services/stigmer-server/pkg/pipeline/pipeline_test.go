package pipeline

import (
	"context"
	"errors"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/telemetry"
	"google.golang.org/protobuf/types/known/emptypb"
)

// mockStep is a test step that tracks execution
type mockStep struct {
	name      string
	executed  bool
	shouldErr bool
	err       error
}

func (s *mockStep) Name() string {
	return s.name
}

func (s *mockStep) Execute(ctx *RequestContext[*emptypb.Empty]) error {
	s.executed = true
	if s.shouldErr {
		return s.err
	}
	return nil
}

func TestPipelineBuilder(t *testing.T) {
	step1 := &mockStep{name: "step1"}
	step2 := &mockStep{name: "step2"}

	pipeline := NewPipeline[*emptypb.Empty]("test-pipeline").
		WithTracer(telemetry.NewNoOpTracer()).
		AddStep(step1).
		AddStep(step2).
		Build()

	if pipeline.Name() != "test-pipeline" {
		t.Errorf("expected pipeline name 'test-pipeline', got '%s'", pipeline.Name())
	}

	if pipeline.StepCount() != 2 {
		t.Errorf("expected 2 steps, got %d", pipeline.StepCount())
	}
}

func TestPipelineExecutesStepsInOrder(t *testing.T) {
	step1 := &mockStep{name: "step1"}
	step2 := &mockStep{name: "step2"}
	step3 := &mockStep{name: "step3"}

	pipeline := NewPipeline[*emptypb.Empty]("test-pipeline").
		AddStep(step1).
		AddStep(step2).
		AddStep(step3).
		Build()

	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})
	err := pipeline.Execute(ctx)

	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}

	if !step1.executed {
		t.Error("step1 was not executed")
	}
	if !step2.executed {
		t.Error("step2 was not executed")
	}
	if !step3.executed {
		t.Error("step3 was not executed")
	}
}

func TestPipelineStopsOnFirstError(t *testing.T) {
	step1 := &mockStep{name: "step1"}
	step2 := &mockStep{name: "step2", shouldErr: true, err: errors.New("step2 failed")}
	step3 := &mockStep{name: "step3"}

	pipeline := NewPipeline[*emptypb.Empty]("test-pipeline").
		AddStep(step1).
		AddStep(step2).
		AddStep(step3).
		Build()

	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})
	err := pipeline.Execute(ctx)

	if err == nil {
		t.Error("expected error, got nil")
	}

	// Verify error is wrapped as PipelineError
	var pipelineErr *PipelineError
	if !errors.As(err, &pipelineErr) {
		t.Error("expected PipelineError")
	}

	if pipelineErr.StepName != "step2" {
		t.Errorf("expected error from step2, got %s", pipelineErr.StepName)
	}

	// Verify step1 executed but step3 did not
	if !step1.executed {
		t.Error("step1 should have executed")
	}
	if !step2.executed {
		t.Error("step2 should have executed")
	}
	if step3.executed {
		t.Error("step3 should not have executed after step2 failed")
	}
}

func TestPipelineWithNoSteps(t *testing.T) {
	pipeline := NewPipeline[*emptypb.Empty]("empty-pipeline").Build()

	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})
	err := pipeline.Execute(ctx)

	if err != nil {
		t.Errorf("expected no error for empty pipeline, got %v", err)
	}
}

func TestPipelineDefaultTracer(t *testing.T) {
	// Pipeline should default to NoOpTracer if none provided
	pipeline := NewPipeline[*emptypb.Empty]("test-pipeline").Build()

	if pipeline.tracer == nil {
		t.Error("expected default tracer to be set")
	}
}

// Test that step results are stored in context
func TestPipelineStoresStepResults(t *testing.T) {
	step1 := &mockStep{name: "step1"}
	step2 := &mockStep{name: "step2"}

	pipeline := NewPipeline[*emptypb.Empty]("test-pipeline").
		AddStep(step1).
		AddStep(step2).
		Build()

	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})
	err := pipeline.Execute(ctx)

	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}

	// Check that results were stored
	result0 := ctx.Get("result_0")
	if result0 == nil {
		t.Error("expected result_0 to be stored in context")
	}

	result1 := ctx.Get("result_1")
	if result1 == nil {
		t.Error("expected result_1 to be stored in context")
	}
}
