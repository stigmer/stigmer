package workflow

import (
	"testing"
)

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
			err := ValidateRuntimeRef(tt.ref)
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
			if got := IsRuntimeRef(tt.s); got != tt.want {
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
			got := ExtractRuntimeRefs(tt.s)
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

// TestRuntimeSecretGeneration tests that RuntimeSecret generates correct placeholders.
func TestRuntimeSecretGeneration(t *testing.T) {
	tests := []struct {
		name     string
		keyName  string
		expected string
	}{
		{"simple key", "API_KEY", "${.secrets.API_KEY}"},
		{"with numbers", "KEY_123", "${.secrets.KEY_123}"},
		{"multiple underscores", "AWS_SECRET_ACCESS_KEY", "${.secrets.AWS_SECRET_ACCESS_KEY}"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RuntimeSecret(tt.keyName)
			if got != tt.expected {
				t.Errorf("RuntimeSecret(%q) = %q, want %q", tt.keyName, got, tt.expected)
			}

			// Verify the generated placeholder is valid
			if err := ValidateRuntimeRef(got); err != nil {
				t.Errorf("RuntimeSecret(%q) generated invalid placeholder: %v", tt.keyName, err)
			}

			// Verify it's recognized as a runtime ref
			if !IsRuntimeRef(got) {
				t.Errorf("RuntimeSecret(%q) generated placeholder not recognized as runtime ref", tt.keyName)
			}
		})
	}
}

// TestRuntimeEnvGeneration tests that RuntimeEnv generates correct placeholders.
func TestRuntimeEnvGeneration(t *testing.T) {
	tests := []struct {
		name     string
		varName  string
		expected string
	}{
		{"simple var", "ENVIRONMENT", "${.env_vars.ENVIRONMENT}"},
		{"with numbers", "VAR_123", "${.env_vars.VAR_123}"},
		{"region", "AWS_REGION", "${.env_vars.AWS_REGION}"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RuntimeEnv(tt.varName)
			if got != tt.expected {
				t.Errorf("RuntimeEnv(%q) = %q, want %q", tt.varName, got, tt.expected)
			}

			// Verify the generated placeholder is valid
			if err := ValidateRuntimeRef(got); err != nil {
				t.Errorf("RuntimeEnv(%q) generated invalid placeholder: %v", tt.varName, err)
			}

			// Verify it's recognized as a runtime ref
			if !IsRuntimeRef(got) {
				t.Errorf("RuntimeEnv(%q) generated placeholder not recognized as runtime ref", tt.varName)
			}
		})
	}
}
