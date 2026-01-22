package workflow_test

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// TestRuntimeSecretPreservedDuringSynthesis verifies that runtime secret placeholders
// are NOT resolved during synthesis (compile-time), ensuring they remain as placeholders
// in the manifest for just-in-time resolution during execution.
//
// **SECURITY CRITICAL TEST**: If this test fails, secrets could leak into Temporal history!
//
// TODO: Re-enable after workflow ToProto() migration is complete
func TestRuntimeSecretPreservedDuringSynthesis(t *testing.T) {
	t.Skip("Skipped: Workflow synthesis not yet migrated to new ToProto() approach")
}

// TestRuntimeRefValidation tests the ValidateRuntimeRef function.
func TestRuntimeRefValidation(t *testing.T) {
	tests := []struct {
		name    string
		ref     string
		wantErr bool
	}{
		// Valid cases
		{"valid secret", "${.secrets.API_KEY}", false},
		{"valid env var", "${.env_vars.ENVIRONMENT}", false},
		{"valid with numbers", "${.secrets.API_KEY_123}", false},
		{"valid with underscores", "${.env_vars.AWS_REGION_ID}", false},

		// Invalid cases
		{"missing leading dot", "${secrets.KEY}", true},
		{"lowercase key", "${.secrets.apiKey}", true},
		{"hyphen in key", "${.secrets.API-KEY}", true},
		{"invalid type", "${.other.KEY}", true},
		{"missing braces", ".secrets.KEY", true},
		{"extra spaces", "${ .secrets.KEY }", true},
		{"starts with number", "${.secrets.123_KEY}", true},
		{"empty key", "${.secrets.}", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := workflow.ValidateRuntimeRef(tt.ref)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateRuntimeRef(%q) error = %v, wantErr %v", tt.ref, err, tt.wantErr)
			}
		})
	}
}

// TestIsRuntimeRef tests the IsRuntimeRef function.
func TestIsRuntimeRef(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want bool
	}{
		// Runtime refs
		{"secret ref", "${.secrets.API_KEY}", true},
		{"env var ref", "${.env_vars.REGION}", true},

		// Not runtime refs
		{"compile-time var", "${apiURL}", false},
		{"context var", "${ $context.apiURL }", false},
		{"plain string", "https://api.example.com", false},
		{"malformed", "${.secrets.api_key}", false}, // lowercase not allowed
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := workflow.IsRuntimeRef(tt.s); got != tt.want {
				t.Errorf("IsRuntimeRef(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

// TestExtractRuntimeRefs tests the ExtractRuntimeRefs function.
func TestExtractRuntimeRefs(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want []string
	}{
		{
			name: "single secret",
			s:    "Bearer ${.secrets.TOKEN}",
			want: []string{"${.secrets.TOKEN}"},
		},
		{
			name: "multiple refs",
			s:    "Bearer ${.secrets.TOKEN} for ${.env_vars.ENVIRONMENT}",
			want: []string{"${.secrets.TOKEN}", "${.env_vars.ENVIRONMENT}"},
		},
		{
			name: "no refs",
			s:    "plain text with ${compileTimeVar}",
			want: []string{},
		},
		{
			name: "mixed",
			s:    "${apiURL} and ${.secrets.KEY} and ${.env_vars.REGION}",
			want: []string{"${.secrets.KEY}", "${.env_vars.REGION}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := workflow.ExtractRuntimeRefs(tt.s)
			if len(got) != len(tt.want) {
				t.Errorf("ExtractRuntimeRefs(%q) = %v, want %v", tt.s, got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("ExtractRuntimeRefs(%q)[%d] = %v, want %v", tt.s, i, got[i], tt.want[i])
				}
			}
		})
	}
}
