package approval

import (
	"testing"
)

func TestParseAction_ValidValues(t *testing.T) {
	tests := []struct {
		input    string
		expected Action
	}{
		{"approve", ActionApprove},
		{"skip", ActionSkip},
		{"reject", ActionReject},
		{"approve-all", ActionApproveAll},
		{"approve_all", ActionApproveAll},
		{"approveall", ActionApproveAll},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			action, err := ParseAction(tt.input)
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tt.input, err)
			}
			if action != tt.expected {
				t.Errorf("ParseAction(%q) = %v, want %v", tt.input, action, tt.expected)
			}
		})
	}
}

func TestParseAction_CaseInsensitive(t *testing.T) {
	tests := []struct {
		input    string
		expected Action
	}{
		{"APPROVE", ActionApprove},
		{"Approve", ActionApprove},
		{"aPpRoVe", ActionApprove},
		{"SKIP", ActionSkip},
		{"Skip", ActionSkip},
		{"REJECT", ActionReject},
		{"Reject", ActionReject},
		{"APPROVE-ALL", ActionApproveAll},
		{"Approve-All", ActionApproveAll},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			action, err := ParseAction(tt.input)
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tt.input, err)
			}
			if action != tt.expected {
				t.Errorf("ParseAction(%q) = %v, want %v", tt.input, action, tt.expected)
			}
		})
	}
}

func TestParseAction_WhitespaceHandling(t *testing.T) {
	tests := []struct {
		input    string
		expected Action
	}{
		{" approve", ActionApprove},
		{"approve ", ActionApprove},
		{" approve ", ActionApprove},
		{"  skip  ", ActionSkip},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			action, err := ParseAction(tt.input)
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tt.input, err)
			}
			if action != tt.expected {
				t.Errorf("ParseAction(%q) = %v, want %v", tt.input, action, tt.expected)
			}
		})
	}
}

func TestParseAction_InvalidValues(t *testing.T) {
	tests := []string{
		"",
		"accept",
		"deny",
		"cancel",
		"yes",
		"no",
		"approved",
		"skipped",
		"rejected",
	}

	for _, input := range tests {
		t.Run(input, func(t *testing.T) {
			action, err := ParseAction(input)
			if err == nil {
				t.Errorf("ParseAction(%q) should return error, got action %v", input, action)
			}
			if action != ActionUnspecified {
				t.Errorf("ParseAction(%q) should return ActionUnspecified on error, got %v", input, action)
			}
		})
	}
}

func TestParseAction_ErrorMessage(t *testing.T) {
	_, err := ParseAction("invalid")
	if err == nil {
		t.Fatal("expected error for invalid input")
	}

	expected := `invalid approval action "invalid": must be one of: approve, skip, reject, approve-all`
	if err.Error() != expected {
		t.Errorf("error message = %q, want %q", err.Error(), expected)
	}
}
