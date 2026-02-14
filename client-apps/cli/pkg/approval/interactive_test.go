package approval

import (
	"context"
	"errors"
	"testing"
)

// =============================================================================
// Action.String() Tests
// =============================================================================

func TestAction_String(t *testing.T) {
	tests := []struct {
		name     string
		action   Action
		expected string
	}{
		{
			name:     "ActionApprove",
			action:   ActionApprove,
			expected: "Approve",
		},
		{
			name:     "ActionSkip",
			action:   ActionSkip,
			expected: "Skip",
		},
		{
			name:     "ActionReject",
			action:   ActionReject,
			expected: "Reject",
		},
		{
			name:     "ActionUnspecified",
			action:   ActionUnspecified,
			expected: "Unspecified",
		},
		{
			name:     "InvalidAction",
			action:   Action(99),
			expected: "Unspecified",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.action.String()
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// indexToAction tests removed — function replaced by Bubbletea prompt model.
// See prompt_model_test.go for the new model tests.

// =============================================================================
// handleNonInteractive Tests
// =============================================================================

func TestHandleNonInteractive_WithDefaultApprove(t *testing.T) {
	p := NewInteractivePrompter()
	opts := Options{
		ToolName:      "write_file",
		DefaultAction: ActionApprove,
	}

	decision, err := p.handleNonInteractive(opts)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionApprove {
		t.Errorf("expected ActionApprove, got %v", decision.Action)
	}
	if decision.Comment != "" {
		t.Errorf("expected empty comment, got %q", decision.Comment)
	}
}

func TestHandleNonInteractive_WithDefaultSkip(t *testing.T) {
	p := NewInteractivePrompter()
	opts := Options{
		ToolName:      "delete_file",
		DefaultAction: ActionSkip,
	}

	decision, err := p.handleNonInteractive(opts)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionSkip {
		t.Errorf("expected ActionSkip, got %v", decision.Action)
	}
}

func TestHandleNonInteractive_WithDefaultReject(t *testing.T) {
	p := NewInteractivePrompter()
	opts := Options{
		ToolName:      "execute_sql",
		DefaultAction: ActionReject,
	}

	decision, err := p.handleNonInteractive(opts)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionReject {
		t.Errorf("expected ActionReject, got %v", decision.Action)
	}
}

func TestHandleNonInteractive_NoDefault_ReturnsError(t *testing.T) {
	p := NewInteractivePrompter()
	opts := Options{
		ToolName:      "write_file",
		DefaultAction: ActionUnspecified, // No default set
	}

	decision, err := p.handleNonInteractive(opts)

	if decision != nil {
		t.Errorf("expected nil decision, got %v", decision)
	}
	if !errors.Is(err, ErrNonInteractiveNoDefault) {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

// =============================================================================
// Prompt Non-Interactive Mode Tests
// =============================================================================

func TestPrompt_NonInteractiveMode_UsesDefaultAction(t *testing.T) {
	p := NewInteractivePrompter()
	ctx := context.Background()
	opts := Options{
		ToolName:       "write_file",
		Message:        "Write to /etc/hosts",
		NonInteractive: true,
		DefaultAction:  ActionApprove,
	}

	decision, err := p.Prompt(ctx, opts)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionApprove {
		t.Errorf("expected ActionApprove, got %v", decision.Action)
	}
}

func TestPrompt_NonInteractiveMode_NoDefault_ReturnsError(t *testing.T) {
	p := NewInteractivePrompter()
	ctx := context.Background()
	opts := Options{
		ToolName:       "write_file",
		Message:        "Write to /etc/hosts",
		NonInteractive: true,
		// DefaultAction not set
	}

	decision, err := p.Prompt(ctx, opts)

	if decision != nil {
		t.Errorf("expected nil decision, got %v", decision)
	}
	if !errors.Is(err, ErrNonInteractiveNoDefault) {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

// =============================================================================
// Decision and Options Tests
// =============================================================================

func TestDecision_ZeroValue(t *testing.T) {
	var d Decision

	if d.Action != ActionUnspecified {
		t.Errorf("expected zero value Action to be ActionUnspecified, got %v", d.Action)
	}
	if d.Comment != "" {
		t.Errorf("expected zero value Comment to be empty, got %q", d.Comment)
	}
}

func TestOptions_ZeroValue(t *testing.T) {
	var opts Options

	if opts.ToolName != "" {
		t.Errorf("expected zero value ToolName to be empty, got %q", opts.ToolName)
	}
	if opts.NonInteractive {
		t.Errorf("expected zero value NonInteractive to be false")
	}
	if opts.DefaultAction != ActionUnspecified {
		t.Errorf("expected zero value DefaultAction to be ActionUnspecified, got %v", opts.DefaultAction)
	}
}

func TestOptions_AllFieldsSet(t *testing.T) {
	opts := Options{
		ToolName:       "write_file",
		Message:        "Write to protected file",
		ArgsPreview:    `{"path": "/etc/hosts"}`,
		NonInteractive: true,
		DefaultAction:  ActionSkip,
	}

	if opts.ToolName != "write_file" {
		t.Errorf("expected ToolName 'write_file', got %q", opts.ToolName)
	}
	if opts.Message != "Write to protected file" {
		t.Errorf("expected Message, got %q", opts.Message)
	}
	if opts.ArgsPreview != `{"path": "/etc/hosts"}` {
		t.Errorf("expected ArgsPreview, got %q", opts.ArgsPreview)
	}
	if !opts.NonInteractive {
		t.Errorf("expected NonInteractive to be true")
	}
	if opts.DefaultAction != ActionSkip {
		t.Errorf("expected DefaultAction ActionSkip, got %v", opts.DefaultAction)
	}
}

// =============================================================================
// NewInteractivePrompter Tests
// =============================================================================

func TestNewInteractivePrompter_DefaultsAskCommentOnReject(t *testing.T) {
	p := NewInteractivePrompter()

	if !p.askCommentOnReject {
		t.Errorf("expected askCommentOnReject to default to true")
	}
}

// =============================================================================
// Error Sentinel Tests
// =============================================================================

func TestErrPromptCancelled_IsDistinct(t *testing.T) {
	if errors.Is(ErrPromptCancelled, ErrNonInteractiveNoDefault) {
		t.Errorf("ErrPromptCancelled should not equal ErrNonInteractiveNoDefault")
	}
}

func TestErrNonInteractiveNoDefault_Message(t *testing.T) {
	msg := ErrNonInteractiveNoDefault.Error()
	if msg != "non-interactive mode requires default action" {
		t.Errorf("unexpected error message: %q", msg)
	}
}

func TestErrPromptCancelled_Message(t *testing.T) {
	msg := ErrPromptCancelled.Error()
	if msg != "prompt cancelled by user" {
		t.Errorf("unexpected error message: %q", msg)
	}
}
