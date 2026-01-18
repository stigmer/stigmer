package templates_test

import (
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/templates"
)

// TestBasicAgent verifies the BasicAgent template is valid Go code.
func TestBasicAgent(t *testing.T) {
	code := templates.BasicAgent()
	verifyValidGoCode(t, "BasicAgent", code)
	verifyContainsImports(t, "BasicAgent", code, []string{
		"github.com/stigmer/stigmer/sdk/go/agent",
		"github.com/stigmer/stigmer/sdk/go/stigmer",
	})
	verifyContainsFunction(t, "BasicAgent", code, "agent.New")
	verifyContainsFunction(t, "BasicAgent", code, "stigmer.Run")
}

// TestBasicWorkflow verifies the BasicWorkflow template is valid Go code.
func TestBasicWorkflow(t *testing.T) {
	code := templates.BasicWorkflow()
	verifyValidGoCode(t, "BasicWorkflow", code)
	verifyContainsImports(t, "BasicWorkflow", code, []string{
		"github.com/stigmer/stigmer/sdk/go/stigmer",
		"github.com/stigmer/stigmer/sdk/go/workflow",
	})
	verifyContainsFunction(t, "BasicWorkflow", code, "workflow.New")
	verifyContainsFunction(t, "BasicWorkflow", code, "stigmer.Run")
}

// TestAgentAndWorkflow verifies the combined template is valid Go code.
func TestAgentAndWorkflow(t *testing.T) {
	code := templates.AgentAndWorkflow()
	verifyValidGoCode(t, "AgentAndWorkflow", code)
	verifyContainsImports(t, "AgentAndWorkflow", code, []string{
		"github.com/stigmer/stigmer/sdk/go/agent",
		"github.com/stigmer/stigmer/sdk/go/stigmer",
		"github.com/stigmer/stigmer/sdk/go/workflow",
	})
	verifyContainsFunction(t, "AgentAndWorkflow", code, "agent.New")
	verifyContainsFunction(t, "AgentAndWorkflow", code, "workflow.New")
	verifyContainsFunction(t, "AgentAndWorkflow", code, "stigmer.Run")
}

// TestTemplatesCompile verifies templates actually compile and run.
// This is an integration test that creates temporary files and runs go build.
func TestTemplatesCompile(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping compilation test in short mode")
	}

	testCases := []struct {
		name     string
		template func() string
	}{
		{"BasicAgent", templates.BasicAgent},
		{"BasicWorkflow", templates.BasicWorkflow},
		{"AgentAndWorkflow", templates.AgentAndWorkflow},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create temporary directory
			tmpDir, err := os.MkdirTemp("", "stigmer-template-test-*")
			if err != nil {
				t.Fatalf("failed to create temp dir: %v", err)
			}
			defer os.RemoveAll(tmpDir)

			// Write main.go
			mainPath := filepath.Join(tmpDir, "main.go")
			if err := os.WriteFile(mainPath, []byte(tc.template()), 0644); err != nil {
				t.Fatalf("failed to write main.go: %v", err)
			}

			// Initialize go.mod
			// Note: Replace path assumes tests run from templates/ directory
			sdkRootPath, err := filepath.Abs("../../..")
			if err != nil {
				t.Fatalf("failed to get SDK root path: %v", err)
			}
			goModContent := fmt.Sprintf(`module test-project

go 1.25.0

require github.com/stigmer/stigmer/sdk/go v0.0.0

replace github.com/stigmer/stigmer/sdk/go => %s
`, sdkRootPath)
			goModPath := filepath.Join(tmpDir, "go.mod")
			if err := os.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
				t.Fatalf("failed to write go.mod: %v", err)
			}

			// Run go mod tidy
			tidyCmd := exec.Command("go", "mod", "tidy")
			tidyCmd.Dir = tmpDir
			if output, err := tidyCmd.CombinedOutput(); err != nil {
				t.Fatalf("go mod tidy failed: %v\nOutput: %s", err, output)
			}

			// Run go build
			buildCmd := exec.Command("go", "build", "-o", "test-binary", ".")
			buildCmd.Dir = tmpDir
			if output, err := buildCmd.CombinedOutput(); err != nil {
				t.Fatalf("go build failed: %v\nOutput: %s", err, output)
			}

			t.Logf("✅ Template %s compiles successfully", tc.name)
		})
	}
}

// TestNoDeprecatedAPIs ensures templates don't use non-existent functions.
// This test specifically guards against the bug where CLI was generating
// calls to NewWithContext() which doesn't exist.
func TestNoDeprecatedAPIs(t *testing.T) {
	testCases := []struct {
		name     string
		template func() string
	}{
		{"BasicAgent", templates.BasicAgent},
		{"BasicWorkflow", templates.BasicWorkflow},
		{"AgentAndWorkflow", templates.AgentAndWorkflow},
	}

	forbiddenPatterns := []string{
		"agent.NewWithContext",
		"workflow.NewWithContext",
		"agent.NewWithoutContext", // hypothetical future mistake
		"workflow.NewWithoutContext",
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			code := tc.template()
			for _, pattern := range forbiddenPatterns {
				if strings.Contains(code, pattern) {
					t.Errorf("Template %s contains forbidden pattern: %s", tc.name, pattern)
				}
			}
		})
	}
}

// TestCorrectAPIs ensures templates use the correct SDK APIs.
func TestCorrectAPIs(t *testing.T) {
	testCases := []struct {
		name          string
		template      func() string
		requiredAPIs  []string
	}{
		{
			name:     "BasicAgent",
			template: templates.BasicAgent,
			requiredAPIs: []string{
				"agent.New(ctx,",
				"stigmer.Run(",
			},
		},
		{
			name:     "BasicWorkflow",
			template: templates.BasicWorkflow,
			requiredAPIs: []string{
				"workflow.New(ctx,",
				"stigmer.Run(",
			},
		},
		{
			name:     "AgentAndWorkflow",
			template: templates.AgentAndWorkflow,
			requiredAPIs: []string{
				"agent.New(ctx,",
				"workflow.New(ctx,",
				"stigmer.Run(",
				"CallAgent(",           // Verify agent call feature is demonstrated
				"workflow.Agent(",      // Verify agent reference
				"ctx.SetString(",       // Verify context variables
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			code := tc.template()
			for _, api := range tc.requiredAPIs {
				if !strings.Contains(code, api) {
					t.Errorf("Template %s missing required API call: %s", tc.name, api)
				}
			}
		})
	}
}

// Helper functions

func verifyValidGoCode(t *testing.T, name, code string) {
	t.Helper()
	fset := token.NewFileSet()
	_, err := parser.ParseFile(fset, name+".go", code, parser.AllErrors)
	if err != nil {
		t.Errorf("Template %s is not valid Go code: %v", name, err)
	}
}

func verifyContainsImports(t *testing.T, name, code string, imports []string) {
	t.Helper()
	for _, imp := range imports {
		if !strings.Contains(code, `"`+imp+`"`) {
			t.Errorf("Template %s missing import: %s", name, imp)
		}
	}
}

func verifyContainsFunction(t *testing.T, name, code, function string) {
	t.Helper()
	if !strings.Contains(code, function) {
		t.Errorf("Template %s missing function call: %s", name, function)
	}
}
