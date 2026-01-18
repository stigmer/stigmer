package workflow

import (
	"reflect"
	"testing"
)

func TestCatchHTTPErrors(t *testing.T) {
	matcher := CatchHTTPErrors()
	expected := []string{ErrorTypeHTTPCall}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchHTTPErrors() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchGRPCErrors(t *testing.T) {
	matcher := CatchGRPCErrors()
	expected := []string{ErrorTypeGRPCCall}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchGRPCErrors() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchValidationErrors(t *testing.T) {
	matcher := CatchValidationErrors()
	expected := []string{ErrorTypeValidation}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchValidationErrors() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchNetworkErrors(t *testing.T) {
	matcher := CatchNetworkErrors()
	expected := []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchNetworkErrors() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchAny(t *testing.T) {
	matcher := CatchAny()
	expected := []string{ErrorTypeAny}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchAny() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchCustom(t *testing.T) {
	matcher := CatchCustom("InsufficientInventory")
	expected := []string{"InsufficientInventory"}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchCustom() = %v, want %v", matcher.Types(), expected)
	}
}

func TestCatchMultiple(t *testing.T) {
	matcher := CatchMultiple("PaymentDeclined", "InsufficientFunds", "CardExpired")
	expected := []string{"PaymentDeclined", "InsufficientFunds", "CardExpired"}

	if !reflect.DeepEqual(matcher.Types(), expected) {
		t.Errorf("CatchMultiple() = %v, want %v", matcher.Types(), expected)
	}
}

func TestErrorMatcherOr(t *testing.T) {
	// Test combining two matchers
	matcher1 := CatchHTTPErrors()
	matcher2 := CatchGRPCErrors()
	combined := matcher1.Or(matcher2)

	expected := []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall}
	if !reflect.DeepEqual(combined.Types(), expected) {
		t.Errorf("ErrorMatcher.Or() = %v, want %v", combined.Types(), expected)
	}

	// Test combining multiple matchers
	matcher3 := CatchValidationErrors()
	combined2 := matcher1.Or(matcher2).Or(matcher3)

	expected2 := []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall, ErrorTypeValidation}
	if !reflect.DeepEqual(combined2.Types(), expected2) {
		t.Errorf("ErrorMatcher.Or() chained = %v, want %v", combined2.Types(), expected2)
	}
}

func TestWithCatchTyped(t *testing.T) {
	// Test that WithCatchTyped works with error matchers
	task := TryTask("test",
		WithTry(SetTask("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors(),
			"err",
			SetTask("handler", SetVar("handled", "true")),
		),
	)

	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		t.Fatal("Task config is not TryTaskConfig")
	}

	if len(cfg.Catch) != 1 {
		t.Fatalf("Expected 1 catch block, got %d", len(cfg.Catch))
	}

	expectedErrors := []string{ErrorTypeHTTPCall}
	if !reflect.DeepEqual(cfg.Catch[0].Errors, expectedErrors) {
		t.Errorf("Catch block errors = %v, want %v", cfg.Catch[0].Errors, expectedErrors)
	}

	if cfg.Catch[0].As != "err" {
		t.Errorf("Catch block 'as' = %q, want %q", cfg.Catch[0].As, "err")
	}
}

func TestWithCatchTypedMultiple(t *testing.T) {
	// Test using multiple WithCatchTyped options
	task := TryTask("test",
		WithTry(SetTask("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors(),
			"httpErr",
			SetTask("handleHTTP", SetVar("handled", "true")),
		),
		WithCatchTyped(
			CatchGRPCErrors(),
			"grpcErr",
			SetTask("handleGRPC", SetVar("handled", "true")),
		),
		WithCatchTyped(
			CatchAny(),
			"err",
			SetTask("handleAny", SetVar("handled", "true")),
		),
	)

	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		t.Fatal("Task config is not TryTaskConfig")
	}

	if len(cfg.Catch) != 3 {
		t.Fatalf("Expected 3 catch blocks, got %d", len(cfg.Catch))
	}

	// Verify first catch block (HTTP)
	if !reflect.DeepEqual(cfg.Catch[0].Errors, []string{ErrorTypeHTTPCall}) {
		t.Errorf("Catch block 0 errors = %v, want [%s]", cfg.Catch[0].Errors, ErrorTypeHTTPCall)
	}

	// Verify second catch block (gRPC)
	if !reflect.DeepEqual(cfg.Catch[1].Errors, []string{ErrorTypeGRPCCall}) {
		t.Errorf("Catch block 1 errors = %v, want [%s]", cfg.Catch[1].Errors, ErrorTypeGRPCCall)
	}

	// Verify third catch block (Any)
	if !reflect.DeepEqual(cfg.Catch[2].Errors, []string{ErrorTypeAny}) {
		t.Errorf("Catch block 2 errors = %v, want [%s]", cfg.Catch[2].Errors, ErrorTypeAny)
	}
}

func TestWithCatchTypedComposition(t *testing.T) {
	// Test using Or() composition in WithCatchTyped
	task := TryTask("test",
		WithTry(SetTask("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors().Or(CatchGRPCErrors()),
			"networkErr",
			SetTask("handleNetwork", SetVar("handled", "true")),
		),
	)

	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		t.Fatal("Task config is not TryTaskConfig")
	}

	if len(cfg.Catch) != 1 {
		t.Fatalf("Expected 1 catch block, got %d", len(cfg.Catch))
	}

	expectedErrors := []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall}
	if !reflect.DeepEqual(cfg.Catch[0].Errors, expectedErrors) {
		t.Errorf("Catch block errors = %v, want %v", cfg.Catch[0].Errors, expectedErrors)
	}
}
