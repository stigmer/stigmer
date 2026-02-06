package environment

import (
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
)

// mockContext implements the Context interface for testing
type mockContext struct {
	environments []*Environment
}

func (m *mockContext) RegisterEnvironment(e *Environment) {
	m.environments = append(m.environments, e)
}

func TestNew(t *testing.T) {
	tests := []struct {
		name      string
		envName   string
		args      *EnvironmentArgs
		wantName  string
		wantSlug  string
		wantErr   bool
		wantCount int // number of data entries
	}{
		{
			name:      "basic environment",
			envName:   "production-aws",
			args:      nil,
			wantName:  "production-aws",
			wantSlug:  "production-aws",
			wantErr:   false,
			wantCount: 0,
		},
		{
			name:    "environment with description and data",
			envName: "staging-gcp",
			args: &EnvironmentArgs{
				Description: "Staging GCP credentials",
				Data: map[string]*environmentv1.EnvironmentValue{
					"GCP_PROJECT": {Value: "my-project", IsSecret: false},
				},
			},
			wantName:  "staging-gcp",
			wantSlug:  "staging-gcp",
			wantErr:   false,
			wantCount: 1,
		},
		{
			name:    "environment with multiple secrets",
			envName: "production-secrets",
			args: &EnvironmentArgs{
				Description: "Production secrets",
				Data: map[string]*environmentv1.EnvironmentValue{
					"AWS_ACCESS_KEY_ID":     {Value: "AKIA...", IsSecret: true},
					"AWS_SECRET_ACCESS_KEY": {Value: "secret...", IsSecret: true},
					"AWS_REGION":            {Value: "us-west-2", IsSecret: false},
				},
			},
			wantName:  "production-secrets",
			wantSlug:  "production-secrets",
			wantErr:   false,
			wantCount: 3,
		},
		{
			name:     "name with spaces gets slugified",
			envName:  "My Production AWS",
			args:     nil,
			wantName: "My Production AWS",
			wantSlug: "my-production-aws",
			wantErr:  false,
		},
		{
			name:     "name with special chars gets slugified",
			envName:  "prod-aws@v2",
			args:     nil,
			wantName: "prod-aws@v2",
			wantSlug: "prod-aws-v2",
			wantErr:  false,
		},
		{
			name:    "empty name returns error",
			envName: "",
			args:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &mockContext{}
			got, err := New(ctx, tt.envName, tt.args)

			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.wantErr {
				return
			}

			if got == nil {
				t.Fatal("New() returned nil without error")
			}

			if got.Name != tt.wantName {
				t.Errorf("New().Name = %v, want %v", got.Name, tt.wantName)
			}

			if got.Slug != tt.wantSlug {
				t.Errorf("New().Slug = %v, want %v", got.Slug, tt.wantSlug)
			}

			if got.Args == nil {
				t.Error("New().Args is nil")
				return
			}

			if got.Args.Data == nil {
				t.Error("New().Args.Data is nil")
				return
			}

			if len(got.Args.Data) != tt.wantCount {
				t.Errorf("len(New().Args.Data) = %v, want %v", len(got.Args.Data), tt.wantCount)
			}

			// Verify registered with context
			if len(ctx.environments) != 1 {
				t.Errorf("context.environments count = %v, want 1", len(ctx.environments))
			}
		})
	}
}

func TestNew_NilContext(t *testing.T) {
	// Should not panic with nil context
	got, err := New(nil, "production", nil)
	if err != nil {
		t.Fatalf("New() with nil context returned error: %v", err)
	}
	if got == nil {
		t.Error("New() with nil context returned nil")
	}
}

func TestEnvironment_Set(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	// Test Set method
	env.Set("MY_VAR", "my-value", false)
	env.Set("MY_SECRET", "secret-value", true)

	if len(env.Args.Data) != 2 {
		t.Errorf("len(Data) = %v, want 2", len(env.Args.Data))
	}

	// Check non-secret
	if v, ok := env.Args.Data["MY_VAR"]; !ok {
		t.Error("MY_VAR not found in Data")
	} else {
		if v.Value != "my-value" {
			t.Errorf("MY_VAR.Value = %v, want my-value", v.Value)
		}
		if v.IsSecret {
			t.Error("MY_VAR.IsSecret should be false")
		}
	}

	// Check secret
	if v, ok := env.Args.Data["MY_SECRET"]; !ok {
		t.Error("MY_SECRET not found in Data")
	} else {
		if v.Value != "secret-value" {
			t.Errorf("MY_SECRET.Value = %v, want secret-value", v.Value)
		}
		if !v.IsSecret {
			t.Error("MY_SECRET.IsSecret should be true")
		}
	}
}

func TestEnvironment_SetWithDescription(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	env.SetWithDescription("AWS_REGION", "us-west-2", false, "AWS region for deployments")

	if v, ok := env.Args.Data["AWS_REGION"]; !ok {
		t.Error("AWS_REGION not found in Data")
	} else {
		if v.Value != "us-west-2" {
			t.Errorf("Value = %v, want us-west-2", v.Value)
		}
		if v.IsSecret {
			t.Error("IsSecret should be false")
		}
		if v.Description != "AWS region for deployments" {
			t.Errorf("Description = %v, want 'AWS region for deployments'", v.Description)
		}
	}
}

func TestEnvironment_SetSecret(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	env.SetSecret("API_KEY", "secret123")

	if v, ok := env.Args.Data["API_KEY"]; !ok {
		t.Error("API_KEY not found in Data")
	} else {
		if v.Value != "secret123" {
			t.Errorf("Value = %v, want secret123", v.Value)
		}
		if !v.IsSecret {
			t.Error("IsSecret should be true")
		}
	}
}

func TestEnvironment_SetConfig(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	env.SetConfig("LOG_LEVEL", "debug")

	if v, ok := env.Args.Data["LOG_LEVEL"]; !ok {
		t.Error("LOG_LEVEL not found in Data")
	} else {
		if v.Value != "debug" {
			t.Errorf("Value = %v, want debug", v.Value)
		}
		if v.IsSecret {
			t.Error("IsSecret should be false")
		}
	}
}

func TestEnvironment_Chaining(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	// Test method chaining
	env.SetConfig("VAR1", "value1").
		SetSecret("VAR2", "secret2").
		SetConfig("VAR3", "value3")

	if len(env.Args.Data) != 3 {
		t.Errorf("len(Data) = %v, want 3", len(env.Args.Data))
	}
}

func TestEnvironment_Accessors(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "test-env", &EnvironmentArgs{
		Description: "Test environment",
		Data: map[string]*environmentv1.EnvironmentValue{
			"VAR1": {Value: "value1"},
		},
	})
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	if env.Description() != "Test environment" {
		t.Errorf("Description() = %v, want 'Test environment'", env.Description())
	}

	if env.Data() == nil {
		t.Error("Data() returned nil")
	}

	if len(env.Data()) != 1 {
		t.Errorf("len(Data()) = %v, want 1", len(env.Data()))
	}
}

func TestEnvironment_String(t *testing.T) {
	ctx := &mockContext{}
	env, err := New(ctx, "production-aws", nil)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	want := "Environment(name=production-aws)"
	got := env.String()
	if got != want {
		t.Errorf("String() = %v, want %v", got, want)
	}
}

func TestEnvironment_NilArgs_Accessors(t *testing.T) {
	// Test that accessors handle nil Args gracefully
	env := &Environment{
		Name: "test",
		Slug: "test",
		Args: nil,
	}

	if env.Description() != "" {
		t.Errorf("Description() with nil Args = %v, want empty string", env.Description())
	}

	if env.Data() != nil {
		t.Errorf("Data() with nil Args = %v, want nil", env.Data())
	}
}
