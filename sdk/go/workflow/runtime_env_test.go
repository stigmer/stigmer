package workflow_test

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/internal/synth"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// TestRuntimeSecretPreservedDuringSynthesis verifies that runtime secret placeholders
// are NOT resolved during synthesis (compile-time), ensuring they remain as placeholders
// in the manifest for just-in-time resolution during execution.
//
// **SECURITY CRITICAL TEST**: If this test fails, secrets could leak into Temporal history!
func TestRuntimeSecretPreservedDuringSynthesis(t *testing.T) {
	// Create a workflow that uses a runtime secret
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		wf, err := workflow.New(ctx,
			workflow.WithName("test-runtime-secret"),
			workflow.WithNamespace("test"),
		)
		if err != nil {
			return err
		}

		// Add HTTP task with runtime secret in header
		task := workflow.HttpCallTask("callAPI",
			workflow.WithHTTPGet(),
			workflow.WithURI("https://api.example.com/data"),
			workflow.Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")),
		)
		wf.AddTask(task)

		return nil
	})

	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	// Get the synthesized manifest
	// Note: In a real scenario, we'd extract the manifest from stigmer.Run()
	// For now, we create it directly to test synthesis behavior
	ctx := stigmer.NewContext()
	wf, _ := workflow.New(ctx,
		workflow.WithName("test-runtime-secret"),
		workflow.WithNamespace("test"),
	)

	// Add some compile-time variables
	apiURL := ctx.SetString("apiURL", "https://api.example.com")
	_ = apiURL // Use the variable to avoid unused warning

	// Add task with BOTH compile-time and runtime placeholders
	task := workflow.HttpCallTask("callAPI",
		workflow.WithHTTPGet(),
		workflow.WithURI("${apiURL}/data"), // Compile-time: should be resolved
		workflow.Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")), // Runtime: should be preserved
		workflow.Header("X-Region", workflow.RuntimeEnv("AWS_REGION")),         // Runtime: should be preserved
	)
	wf.AddTask(task)

	// Synthesize the workflow
	manifest, err := synth.ToWorkflowManifestWithContext(ctx.ExportVariables(), wf)
	if err != nil {
		t.Fatalf("Failed to synthesize workflow: %v", err)
	}

	// Verify we have exactly one workflow with one task
	if len(manifest.Workflows) != 1 {
		t.Fatalf("Expected 1 workflow, got %d", len(manifest.Workflows))
	}
	if len(manifest.Workflows[0].Spec.Tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(manifest.Workflows[0].Spec.Tasks))
	}

	// Get the task config as a map
	taskConfig := manifest.Workflows[0].Spec.Tasks[0].TaskConfig.AsMap()

	// Verify URI was resolved (compile-time variable)
	endpoint, ok := taskConfig["endpoint"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected endpoint to be a map, got %T", taskConfig["endpoint"])
	}
	uri, ok := endpoint["uri"].(string)
	if !ok {
		t.Fatalf("Expected URI to be a string, got %T", endpoint["uri"])
	}

	// CRITICAL: Compile-time variables should be resolved
	expectedURI := "https://api.example.com/data"
	if uri != expectedURI {
		t.Errorf("Expected URI to be resolved to %q, got %q", expectedURI, uri)
	}

	// Get headers
	headers, ok := taskConfig["headers"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected headers to be a map, got %T", taskConfig["headers"])
	}

	// CRITICAL: Runtime secret placeholder should be PRESERVED
	authHeader, ok := headers["Authorization"].(string)
	if !ok {
		t.Fatalf("Expected Authorization header to be a string, got %T", headers["Authorization"])
	}

	expectedAuthPlaceholder := "${.secrets.OPENAI_KEY}"
	if authHeader != expectedAuthPlaceholder {
		t.Errorf("SECURITY FAILURE: Runtime secret was resolved during synthesis!\n"+
			"Expected: %q\n"+
			"Got: %q\n"+
			"This means secrets could leak into Temporal history!",
			expectedAuthPlaceholder, authHeader)
	}

	// CRITICAL: Runtime env placeholder should be PRESERVED
	regionHeader, ok := headers["X-Region"].(string)
	if !ok {
		t.Fatalf("Expected X-Region header to be a string, got %T", headers["X-Region"])
	}

	expectedRegionPlaceholder := "${.env_vars.AWS_REGION}"
	if regionHeader != expectedRegionPlaceholder {
		t.Errorf("Runtime env variable was resolved during synthesis!\n"+
			"Expected: %q\n"+
			"Got: %q",
			expectedRegionPlaceholder, regionHeader)
	}

	t.Logf("✅ SUCCESS: Runtime placeholders preserved during synthesis")
	t.Logf("  - Compile-time variable ${apiURL} resolved to: %s", uri)
	t.Logf("  - Runtime secret ${.secrets.OPENAI_KEY} preserved as: %s", authHeader)
	t.Logf("  - Runtime env ${.env_vars.AWS_REGION} preserved as: %s", regionHeader)
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
