package pipeline

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/telemetry"
	"google.golang.org/protobuf/types/known/emptypb"
)

func TestNewRequestContext(t *testing.T) {
	input := &emptypb.Empty{}
	ctx := NewRequestContext(context.Background(), input)

	if ctx.Input() != input {
		t.Error("input not set correctly")
	}

	if ctx.Context() == nil {
		t.Error("context should not be nil")
	}

	if ctx.metadata == nil {
		t.Error("metadata map should be initialized")
	}
}

func TestContextMetadata(t *testing.T) {
	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})

	// Set values
	ctx.Set("key1", "value1")
	ctx.Set("key2", 42)
	ctx.Set("key3", true)

	// Get values
	if ctx.Get("key1") != "value1" {
		t.Error("expected key1 to be 'value1'")
	}

	if ctx.Get("key2") != 42 {
		t.Error("expected key2 to be 42")
	}

	if ctx.Get("key3") != true {
		t.Error("expected key3 to be true")
	}

	// Get non-existent key
	if ctx.Get("nonexistent") != nil {
		t.Error("expected nil for non-existent key")
	}
}

func TestContextState(t *testing.T) {
	input := &emptypb.Empty{}
	ctx := NewRequestContext(context.Background(), input)

	// Initially NewState should be nil
	if ctx.NewState() != nil {
		t.Error("NewState should initially be nil")
	}

	// Set new state
	newState := &emptypb.Empty{}
	ctx.SetNewState(newState)

	if ctx.NewState() != newState {
		t.Error("NewState not set correctly")
	}
}

func TestContextGoContext(t *testing.T) {
	originalCtx := context.Background()
	ctx := NewRequestContext(originalCtx, &emptypb.Empty{})

	if ctx.Context() != originalCtx {
		t.Error("Context not set correctly")
	}

	// Update context
	newCtx := context.WithValue(originalCtx, "key", "value")
	ctx.SetContext(newCtx)

	if ctx.Context() != newCtx {
		t.Error("Context not updated correctly")
	}
}

func TestContextSpan(t *testing.T) {
	ctx := NewRequestContext(context.Background(), &emptypb.Empty{})

	// Initially span should be nil
	if ctx.Span() != nil {
		t.Error("Span should initially be nil")
	}

	// Set span
	span := &telemetry.NoOpSpan{}
	ctx.SetSpan(span)

	if ctx.Span() != span {
		t.Error("Span not set correctly")
	}
}

func TestContextMetadataIsolation(t *testing.T) {
	ctx1 := NewRequestContext(context.Background(), &emptypb.Empty{})
	ctx2 := NewRequestContext(context.Background(), &emptypb.Empty{})

	ctx1.Set("key", "value1")
	ctx2.Set("key", "value2")

	if ctx1.Get("key") == ctx2.Get("key") {
		t.Error("context metadata should be isolated")
	}
}
