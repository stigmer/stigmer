package agent

import (
	"errors"
	"testing"
)

func TestValidationError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ValidationError
		expected string
	}{
		{
			name: "with field",
			err: &ValidationError{
				Field:   "name",
				Value:   "invalid",
				Rule:    "format",
				Message: "invalid format",
			},
			expected: `validation failed for field "name": invalid format`,
		},
		{
			name: "without field",
			err: &ValidationError{
				Message: "validation failed",
			},
			expected: "validation failed: validation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("ValidationError.Error() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestValidationError_Unwrap(t *testing.T) {
	cause := errors.New("underlying error")
	err := &ValidationError{
		Field:   "test",
		Message: "test error",
		Err:     cause,
	}

	if got := err.Unwrap(); got != cause {
		t.Errorf("ValidationError.Unwrap() = %v, want %v", got, cause)
	}
}

func TestValidationError_Is(t *testing.T) {
	tests := []struct {
		name   string
		err    *ValidationError
		target error
		want   bool
	}{
		{
			name:   "matches ErrInvalidName",
			err:    NewValidationErrorWithCause("name", "invalid", "format", "invalid name", ErrInvalidName),
			target: ErrInvalidName,
			want:   true,
		},
		{
			name:   "matches ErrInvalidInstructions",
			err:    NewValidationErrorWithCause("instructions", "short", "min_length", "too short", ErrInvalidInstructions),
			target: ErrInvalidInstructions,
			want:   true,
		},
		{
			name:   "does not match",
			err:    NewValidationError("test", "value", "rule", "message"),
			target: ErrInvalidName,
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := errors.Is(tt.err, tt.target); got != tt.want {
				t.Errorf("errors.Is() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewValidationError(t *testing.T) {
	err := NewValidationError("field", "value", "rule", "message")

	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Value != "value" {
		t.Errorf("Value = %v, want %v", err.Value, "value")
	}
	if err.Rule != "rule" {
		t.Errorf("Rule = %v, want %v", err.Rule, "rule")
	}
	if err.Message != "message" {
		t.Errorf("Message = %v, want %v", err.Message, "message")
	}
	if err.Err != nil {
		t.Errorf("Err = %v, want nil", err.Err)
	}
}

func TestNewValidationErrorWithCause(t *testing.T) {
	cause := errors.New("cause")
	err := NewValidationErrorWithCause("field", "value", "rule", "message", cause)

	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Err != cause {
		t.Errorf("Err = %v, want %v", err.Err, cause)
	}
}

func TestConversionError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ConversionError
		expected string
	}{
		{
			name: "with field",
			err: &ConversionError{
				Type:    "Agent",
				Field:   "name",
				Message: "conversion failed",
			},
			expected: "failed to convert Agent.name: conversion failed",
		},
		{
			name: "without field",
			err: &ConversionError{
				Type:    "Agent",
				Message: "conversion failed",
			},
			expected: "failed to convert Agent: conversion failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("ConversionError.Error() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestConversionError_Unwrap(t *testing.T) {
	cause := errors.New("underlying error")
	err := &ConversionError{
		Type:    "Agent",
		Message: "test error",
		Err:     cause,
	}

	if got := err.Unwrap(); got != cause {
		t.Errorf("ConversionError.Unwrap() = %v, want %v", got, cause)
	}
}

func TestNewConversionError(t *testing.T) {
	err := NewConversionError("Agent", "field", "message")

	if err.Type != "Agent" {
		t.Errorf("Type = %v, want %v", err.Type, "Agent")
	}
	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Message != "message" {
		t.Errorf("Message = %v, want %v", err.Message, "message")
	}
	if err.Err != nil {
		t.Errorf("Err = %v, want nil", err.Err)
	}
}

func TestNewConversionErrorWithCause(t *testing.T) {
	cause := errors.New("cause")
	err := NewConversionErrorWithCause("Agent", "field", "message", cause)

	if err.Type != "Agent" {
		t.Errorf("Type = %v, want %v", err.Type, "Agent")
	}
	if err.Err != cause {
		t.Errorf("Err = %v, want %v", err.Err, cause)
	}
}
