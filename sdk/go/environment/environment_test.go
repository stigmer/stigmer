package environment

import (
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name    string
		opts    []Option
		want    Variable
		wantErr bool
	}{
		{
			name: "minimal required variable",
			opts: []Option{
				WithName("GITHUB_TOKEN"),
			},
			want: Variable{
				Name:     "GITHUB_TOKEN",
				Required: true,
			},
			wantErr: false,
		},
		{
			name: "secret variable with description",
			opts: []Option{
				WithName("API_KEY"),
				WithSecret(true),
				WithDescription("API key for external service"),
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
			name: "optional variable with default",
			opts: []Option{
				WithName("AWS_REGION"),
				WithDefaultValue("us-east-1"),
				WithDescription("AWS region"),
			},
			want: Variable{
				Name:         "AWS_REGION",
				DefaultValue: "us-east-1",
				Description:  "AWS region",
				Required:     false, // Automatically set by WithDefaultValue
			},
			wantErr: false,
		},
		{
			name: "config variable not secret",
			opts: []Option{
				WithName("LOG_LEVEL"),
				WithSecret(false),
				WithDefaultValue("info"),
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
			name: "explicitly optional",
			opts: []Option{
				WithName("DEBUG_MODE"),
				WithRequired(false),
			},
			want: Variable{
				Name:     "DEBUG_MODE",
				Required: false,
			},
			wantErr: false,
		},
		{
			name:    "missing name",
			opts:    []Option{},
			wantErr: true,
		},
		{
			name: "invalid name - lowercase",
			opts: []Option{
				WithName("github_token"),
			},
			wantErr: true,
		},
		{
			name: "invalid name - starts with number",
			opts: []Option{
				WithName("1_TOKEN"),
			},
			wantErr: true,
		},
		{
			name: "invalid name - special characters",
			opts: []Option{
				WithName("GITHUB-TOKEN"),
			},
			wantErr: true,
		},
		{
			name: "valid name with numbers",
			opts: []Option{
				WithName("API_KEY_V2"),
			},
			want: Variable{
				Name:     "API_KEY_V2",
				Required: true,
			},
			wantErr: false,
		},
		{
			name: "valid name with underscores",
			opts: []Option{
				WithName("MY_SUPER_LONG_VAR_NAME"),
			},
			want: Variable{
				Name:     "MY_SUPER_LONG_VAR_NAME",
				Required: true,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.opts...)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr {
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

func TestIsValidEnvVarName(t *testing.T) {
	tests := []struct {
		name string
		arg  string
		want bool
	}{
		{"valid uppercase", "GITHUB_TOKEN", true},
		{"valid with numbers", "API_KEY_V2", true},
		{"valid with underscores", "MY_SUPER_VAR", true},
		{"valid single char", "X", true},
		{"invalid empty", "", false},
		{"invalid lowercase", "github_token", false},
		{"invalid mixed case", "GitHub_Token", false},
		{"invalid starts with number", "2FA_TOKEN", false},
		{"invalid hyphen", "API-KEY", false},
		{"invalid dot", "API.KEY", false},
		{"invalid space", "API KEY", false},
		{"invalid special chars", "API_KEY!", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidEnvVarName(tt.arg)
			if got != tt.want {
				t.Errorf("isValidEnvVarName(%q) = %v, want %v", tt.arg, got, tt.want)
			}
		})
	}
}
