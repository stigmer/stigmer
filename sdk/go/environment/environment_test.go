package environment

import (
	"testing"
)

// mockContext implements the Context interface for testing
type mockContext struct{}

func TestNew(t *testing.T) {
	ctx := &mockContext{}

	tests := []struct {
		name    string
		varName string
		args    *VariableArgs
		want    Variable
		wantErr bool
	}{
		{
			name:    "minimal required variable",
			varName: "GITHUB_TOKEN",
			args:    nil,
			want: Variable{
				Name:     "GITHUB_TOKEN",
				Required: true,
			},
			wantErr: false,
		},
		{
			name:    "secret variable with description",
			varName: "API_KEY",
			args: &VariableArgs{
				IsSecret:    true,
				Description: "API key for external service",
			},
			want: Variable{
				Name:        "API_KEY",
				IsSecret:    true,
				Description: "API key for external service",
				Required:    true,
			},
			wantErr: false,
		},
		{
			name:    "optional variable with default",
			varName: "AWS_REGION",
			args: &VariableArgs{
				DefaultValue: "us-east-1",
				Description:  "AWS region",
			},
			want: Variable{
				Name:         "AWS_REGION",
				DefaultValue: "us-east-1",
				Description:  "AWS region",
				Required:     false, // Automatically set by DefaultValue
			},
			wantErr: false,
		},
		{
			name:    "config variable not secret",
			varName: "LOG_LEVEL",
			args: &VariableArgs{
				IsSecret:     false,
				DefaultValue: "info",
			},
			want: Variable{
				Name:         "LOG_LEVEL",
				IsSecret:     false,
				DefaultValue: "info",
				Required:     false,
			},
			wantErr: false,
		},
		{
			name:    "explicitly optional",
			varName: "DEBUG_MODE",
			args: &VariableArgs{
				Required: ptrBool(false),
			},
			want: Variable{
				Name:     "DEBUG_MODE",
				Required: false,
			},
			wantErr: false,
		},
		{
			name:    "missing name",
			varName: "",
			args:    nil,
			wantErr: true,
		},
		{
			name:    "invalid name - lowercase",
			varName: "github_token",
			args:    nil,
			wantErr: true,
		},
		{
			name:    "invalid name - starts with number",
			varName: "1_TOKEN",
			args:    nil,
			wantErr: true,
		},
		{
			name:    "invalid name - special characters",
			varName: "GITHUB-TOKEN",
			args:    nil,
			wantErr: true,
		},
		{
			name:    "valid name with numbers",
			varName: "API_KEY_V2",
			args:    nil,
			want: Variable{
				Name:     "API_KEY_V2",
				Required: true,
			},
			wantErr: false,
		},
		{
			name:    "valid name with underscores",
			varName: "MY_SUPER_LONG_VAR_NAME",
			args:    nil,
			want: Variable{
				Name:     "MY_SUPER_LONG_VAR_NAME",
				Required: true,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(ctx, tt.varName, tt.args)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != nil {
				if got.Name != tt.want.Name {
					t.Errorf("New().Name = %v, want %v", got.Name, tt.want.Name)
				}
				if got.IsSecret != tt.want.IsSecret {
					t.Errorf("New().IsSecret = %v, want %v", got.IsSecret, tt.want.IsSecret)
				}
				if got.Description != tt.want.Description {
					t.Errorf("New().Description = %v, want %v", got.Description, tt.want.Description)
				}
				if got.DefaultValue != tt.want.DefaultValue {
					t.Errorf("New().DefaultValue = %v, want %v", got.DefaultValue, tt.want.DefaultValue)
				}
				if got.Required != tt.want.Required {
					t.Errorf("New().Required = %v, want %v", got.Required, tt.want.Required)
				}
			}
		})
	}
}

// ptrBool returns a pointer to a bool value
func ptrBool(b bool) *bool {
	return &b
}

func TestVariableString(t *testing.T) {
	tests := []struct {
		name     string
		variable Variable
		want     string
	}{
		{
			name: "required non-secret",
			variable: Variable{
				Name:     "API_URL",
				Required: true,
			},
			want: "EnvVar(API_URL)",
		},
		{
			name: "required secret",
			variable: Variable{
				Name:     "API_KEY",
				IsSecret: true,
				Required: true,
			},
			want: "EnvVar(API_KEY (secret))",
		},
		{
			name: "optional non-secret",
			variable: Variable{
				Name:     "LOG_LEVEL",
				Required: false,
			},
			want: "EnvVar(LOG_LEVEL (optional))",
		},
		{
			name: "optional secret",
			variable: Variable{
				Name:     "OPTIONAL_TOKEN",
				IsSecret: true,
				Required: false,
			},
			want: "EnvVar(OPTIONAL_TOKEN (secret) (optional))",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.variable.String()
			if got != tt.want {
				t.Errorf("Variable.String() = %v, want %v", got, tt.want)
			}
		})
	}
}
