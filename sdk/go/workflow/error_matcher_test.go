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
	task := Try("test",
		WithTry(Set("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors(),
			"err",
			Set("handler", SetVar("handled", "true")),
		),
	)

	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		t.Fatal("Task config is not TryTaskConfig")
	}

	if len(cfg.Catch) != 1 {
		t.Fatalf("Expected 1 catch block, got %d", len(cfg.Catch))
	}

	catchBlock := cfg.Catch[0]
	errors, ok := catchBlock["errors"].([]string)
	if !ok {
		t.Fatal("Catch block errors field is not []string")
	}

	expectedErrors := []string{ErrorTypeHTTPCall}
	if !reflect.DeepEqual(errors, expectedErrors) {
		t.Errorf("Catch block errors = %v, want %v", errors, expectedErrors)
	}

	as, ok := catchBlock["as"].(string)
	if !ok {
		t.Fatal("Catch block 'as' field is not string")
	}

	if as != "err" {
		t.Errorf("Catch block 'as' = %q, want %q", as, "err")
	}
}

func TestWithCatchTypedMultiple(t *testing.T) {
	// Test using multiple WithCatchTyped options
	task := Try("test",
		WithTry(Set("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors(),
			"httpErr",
			Set("handleHTTP", SetVar("handled", "true")),
		),
		WithCatchTyped(
			CatchGRPCErrors(),
			"grpcErr",
			Set("handleGRPC", SetVar("handled", "true")),
		),
		WithCatchTyped(
			CatchAny(),
			"err",
			Set("handleAny", SetVar("handled", "true")),
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
	errors0, _ := cfg.Catch[0]["errors"].([]string)
	if !reflect.DeepEqual(errors0, []string{ErrorTypeHTTPCall}) {
		t.Errorf("Catch block 0 errors = %v, want [%s]", errors0, ErrorTypeHTTPCall)
	}

	// Verify second catch block (gRPC)
	errors1, _ := cfg.Catch[1]["errors"].([]string)
	if !reflect.DeepEqual(errors1, []string{ErrorTypeGRPCCall}) {
		t.Errorf("Catch block 1 errors = %v, want [%s]", errors1, ErrorTypeGRPCCall)
	}

	// Verify third catch block (Any)
	errors2, _ := cfg.Catch[2]["errors"].([]string)
	if !reflect.DeepEqual(errors2, []string{ErrorTypeAny}) {
		t.Errorf("Catch block 2 errors = %v, want [%s]", errors2, ErrorTypeAny)
	}
}

func TestWithCatchTypedComposition(t *testing.T) {
	// Test using Or() composition in WithCatchTyped
	task := Try("test",
		WithTry(Set("risky", SetVar("x", "1"))),
		WithCatchTyped(
			CatchHTTPErrors().Or(CatchGRPCErrors()),
			"networkErr",
			Set("handleNetwork", SetVar("handled", "true")),
		),
	)

	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		t.Fatal("Task config is not TryTaskConfig")
	}

	if len(cfg.Catch) != 1 {
		t.Fatalf("Expected 1 catch block, got %d", len(cfg.Catch))
	}

	errors, _ := cfg.Catch[0]["errors"].([]string)
	expectedErrors := []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall}
	if !reflect.DeepEqual(errors, expectedErrors) {
		t.Errorf("Catch block errors = %v, want %v", errors, expectedErrors)
	}
}
