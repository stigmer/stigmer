package root

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/fatih/color"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// captureColorOutput captures output from color.Printf, fmt.Println, and climsg
// during test execution. Redirects stdout, color.Output, and climsg to a pipe.
func captureColorOutput(t *testing.T, f func()) string {
	t.Helper()

	oldStdout := os.Stdout
	oldColorOutput := color.Output

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}

	os.Stdout = w
	color.Output = w
	restoreClimsg := climsg.ReplaceOutput(w)

	f()

	w.Close()
	os.Stdout = oldStdout
	color.Output = oldColorOutput
	restoreClimsg()

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("failed to read captured output: %v", err)
	}

	return buf.String()
}

// =============================================================================
// mapApprovalAction Tests
// =============================================================================

func TestMapApprovalAction_AllCases(t *testing.T) {
	tests := []struct {
		name     string
		input    approval.Action
		expected agentexecutionv1.ApprovalAction
	}{
		{
			name:     "ActionApprove maps to APPROVAL_ACTION_APPROVE",
			input:    approval.ActionApprove,
			expected: agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		},
		{
			name:     "ActionSkip maps to APPROVAL_ACTION_SKIP",
			input:    approval.ActionSkip,
			expected: agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		},
		{
			name:     "ActionReject maps to APPROVAL_ACTION_REJECT",
			input:    approval.ActionReject,
			expected: agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		},
		{
			name:     "ActionUnspecified maps to APPROVAL_ACTION_UNSPECIFIED",
			input:    approval.ActionUnspecified,
			expected: agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED,
		},
		{
			name:     "Unknown action maps to APPROVAL_ACTION_UNSPECIFIED",
			input:    approval.Action(999), // Invalid action
			expected: agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapApprovalAction(tt.input)
			if result != tt.expected {
				t.Errorf("mapApprovalAction(%v) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapApprovalAction_EnumValuesMatch(t *testing.T) {
	// Verify the numeric values match between our Action and proto ApprovalAction
	// This ensures consistency when the enums are used for serialization

	// ActionApprove (1) should map to APPROVAL_ACTION_APPROVE (1)
	if mapApprovalAction(approval.ActionApprove) != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Error("ActionApprove should map to APPROVAL_ACTION_APPROVE")
	}

	// ActionSkip (2) should map to APPROVAL_ACTION_SKIP (2)
	if mapApprovalAction(approval.ActionSkip) != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP {
		t.Error("ActionSkip should map to APPROVAL_ACTION_SKIP")
	}

	// ActionReject (3) should map to APPROVAL_ACTION_REJECT (3)
	if mapApprovalAction(approval.ActionReject) != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
		t.Error("ActionReject should map to APPROVAL_ACTION_REJECT")
	}
}

// =============================================================================
// displayApprovalSubmitted Tests
// =============================================================================

func TestDisplayApprovalSubmitted_Approve(t *testing.T) {
	output := captureColorOutput(t, func() {
		displayApprovalSubmitted(approval.ActionApprove)
	})

	if !strings.Contains(output, "approved") {
		t.Errorf("expected output to contain 'approved', got: %s", output)
	}
}

func TestDisplayApprovalSubmitted_Skip(t *testing.T) {
	output := captureColorOutput(t, func() {
		displayApprovalSubmitted(approval.ActionSkip)
	})

	if !strings.Contains(output, "skipped") {
		t.Errorf("expected output to contain 'skipped', got: %s", output)
	}
}

func TestDisplayApprovalSubmitted_Reject(t *testing.T) {
	output := captureColorOutput(t, func() {
		displayApprovalSubmitted(approval.ActionReject)
	})

	if !strings.Contains(output, "rejected") {
		t.Errorf("expected output to contain 'rejected', got: %s", output)
	}
}

func TestDisplayApprovalSubmitted_Unspecified(t *testing.T) {
	output := captureColorOutput(t, func() {
		displayApprovalSubmitted(approval.ActionUnspecified)
	})

	if !strings.Contains(output, "submitted") {
		t.Errorf("expected output to contain 'submitted', got: %s", output)
	}
}

func TestDisplayApprovalSubmitted_AllActions(t *testing.T) {
	tests := []struct {
		name           string
		action         approval.Action
		containsString string
	}{
		{
			name:           "Approve shows success message",
			action:         approval.ActionApprove,
			containsString: "approved",
		},
		{
			name:           "Skip shows warning message",
			action:         approval.ActionSkip,
			containsString: "skipped",
		},
		{
			name:           "Reject shows error message",
			action:         approval.ActionReject,
			containsString: "rejected",
		},
		{
			name:           "Unspecified shows generic message",
			action:         approval.ActionUnspecified,
			containsString: "submitted",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output := captureColorOutput(t, func() {
				displayApprovalSubmitted(tt.action)
			})

			if !strings.Contains(strings.ToLower(output), tt.containsString) {
				t.Errorf("expected output to contain '%s', got: %s", tt.containsString, output)
			}
		})
	}
}

// =============================================================================
// approvalSubmitTimeout Tests
// =============================================================================

func TestApprovalSubmitTimeout_IsReasonable(t *testing.T) {
	// Verify the timeout is in a reasonable range (1-30 seconds)
	if approvalSubmitTimeout.Seconds() < 1 {
		t.Errorf("approvalSubmitTimeout too short: %v", approvalSubmitTimeout)
	}
	if approvalSubmitTimeout.Seconds() > 30 {
		t.Errorf("approvalSubmitTimeout too long: %v", approvalSubmitTimeout)
	}
}

// =============================================================================
// Decision Struct Tests
// =============================================================================

func TestDecision_WithComment(t *testing.T) {
	decision := &approval.Decision{
		Action:  approval.ActionReject,
		Comment: "Unsafe operation",
	}

	if decision.Action != approval.ActionReject {
		t.Errorf("expected ActionReject, got %v", decision.Action)
	}
	if decision.Comment != "Unsafe operation" {
		t.Errorf("expected 'Unsafe operation', got %s", decision.Comment)
	}
}

func TestDecision_EmptyComment(t *testing.T) {
	decision := &approval.Decision{
		Action:  approval.ActionApprove,
		Comment: "",
	}

	if decision.Action != approval.ActionApprove {
		t.Errorf("expected ActionApprove, got %v", decision.Action)
	}
	if decision.Comment != "" {
		t.Errorf("expected empty comment, got %s", decision.Comment)
	}
}

// =============================================================================
// Input Validation Tests (for submitAgentApproval/submitWorkflowApproval)
// =============================================================================

// Note: These tests verify the input structures are built correctly.
// Actual gRPC calls require integration tests with a running backend.

func TestSubmitApprovalInput_FieldMapping(t *testing.T) {
	// Verify that the Decision struct fields are correctly mapped to proto input
	decision := &approval.Decision{
		Action:  approval.ActionApprove,
		Comment: "Test comment",
	}

	// Test that mapApprovalAction works with the decision
	mappedAction := mapApprovalAction(decision.Action)
	if mappedAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("expected APPROVAL_ACTION_APPROVE, got %v", mappedAction)
	}

	// Verify comment is accessible
	if decision.Comment != "Test comment" {
		t.Errorf("expected 'Test comment', got %s", decision.Comment)
	}
}

func TestSubmitApprovalInput_AllActions(t *testing.T) {
	actions := []approval.Action{
		approval.ActionApprove,
		approval.ActionSkip,
		approval.ActionReject,
	}

	for _, action := range actions {
		decision := &approval.Decision{
			Action:  action,
			Comment: "",
		}

		mapped := mapApprovalAction(decision.Action)
		if mapped == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
			t.Errorf("valid action %v should not map to UNSPECIFIED", action)
		}
	}
}
