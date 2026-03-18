package main

import (
	"encoding/json"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeJSON(t *testing.T, path string, v interface{}) {
	t.Helper()
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("marshal JSON for %s: %v", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("create dir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func verifyGoFiles(t *testing.T, dir string) int {
	t.Helper()
	fset := token.NewFileSet()
	count := 0
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("read generated file %s: %v", path, err)
			return nil
		}
		if _, err := parser.ParseFile(fset, path, data, parser.AllErrors); err != nil {
			t.Errorf("generated file %s has parse errors: %v\nContent:\n%s", path, err, string(data))
		}
		count++
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", dir, err)
	}
	return count
}

// TestIntegrationSyntheticSchemas verifies the full pipeline: JSON schema files
// on disk -> Generator -> generated Go files that pass go/format.Source() and
// go/parser.ParseFile. Uses carefully crafted schemas that exercise every
// TypeSpec.Kind and major code-generation path.
func TestIntegrationSyntheticSchemas(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	// --- Task configs (schemas/tasks/) ---

	writeJSON(t, filepath.Join(schemasDir, "tasks", "scalar.json"), &TaskConfigSchema{
		Name:        "ScalarTaskConfig",
		Kind:        "SCALAR",
		Description: "Task with all scalar field types.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.ScalarTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/scalar.proto",
		Fields: []*FieldSchema{
			{Name: "Title", JsonName: "title", ProtoField: "title", Type: TypeSpec{Kind: "string"}, Required: true},
			{Name: "Count", JsonName: "count", ProtoField: "count", Type: TypeSpec{Kind: "int32"}},
			{Name: "BigCount", JsonName: "bigCount", ProtoField: "big_count", Type: TypeSpec{Kind: "int64"}},
			{Name: "SmallId", JsonName: "smallId", ProtoField: "small_id", Type: TypeSpec{Kind: "uint32"}},
			{Name: "Active", JsonName: "active", ProtoField: "active", Type: TypeSpec{Kind: "bool"}},
			{Name: "Score", JsonName: "score", ProtoField: "score", Type: TypeSpec{Kind: "float"}},
			{Name: "Ratio", JsonName: "ratio", ProtoField: "ratio", Type: TypeSpec{Kind: "double"}},
			{Name: "Payload", JsonName: "payload", ProtoField: "payload", Type: TypeSpec{Kind: "bytes"}},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "tasks", "maps.json"), &TaskConfigSchema{
		Name:        "MapTaskConfig",
		Kind:        "MAP",
		Description: "Task with map fields.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.MapTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/maps.proto",
		Fields: []*FieldSchema{
			{Name: "Variables", JsonName: "variables", ProtoField: "variables",
				Type: TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "string"}}, Required: true},
			{Name: "Scores", JsonName: "scores", ProtoField: "scores",
				Type: TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "int32"}}},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "tasks", "arrays.json"), &TaskConfigSchema{
		Name:        "ArrayTaskConfig",
		Kind:        "ARRAY",
		Description: "Task with array and well-known type fields.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.ArrayTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/arrays.proto",
		Fields: []*FieldSchema{
			{Name: "Tags", JsonName: "tags", ProtoField: "tags",
				Type: TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "string"}}},
			{Name: "Ids", JsonName: "ids", ProtoField: "ids",
				Type: TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "int32"}}},
			{Name: "CreatedAt", JsonName: "createdAt", ProtoField: "created_at",
				Type: TypeSpec{Kind: "message", MessageType: "Timestamp"}},
			{Name: "Timeout", JsonName: "timeout", ProtoField: "timeout",
				Type: TypeSpec{Kind: "message", MessageType: "Duration"}},
			{Name: "Config", JsonName: "config", ProtoField: "config",
				Type: TypeSpec{Kind: "struct"}},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "tasks", "expr.json"), &TaskConfigSchema{
		Name:        "ExprTaskConfig",
		Kind:        "EXPR",
		Description: "Task with expression fields.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.ExprTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/expr.proto",
		Fields: []*FieldSchema{
			{Name: "Target", JsonName: "target", ProtoField: "target",
				Type: TypeSpec{Kind: "string"}, IsExpression: true},
			{Name: "Name", JsonName: "name", ProtoField: "name",
				Type: TypeSpec{Kind: "string"}},
		},
	})

	// --- Shared types (schemas/types/) ---

	writeJSON(t, filepath.Join(schemasDir, "types", "endpoint.json"), &TypeSchema{
		Name:        "TestEndpoint",
		Description: "A test shared type.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.TestEndpoint",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/types.proto",
		Fields: []*FieldSchema{
			{Name: "Url", JsonName: "url", ProtoField: "url", Type: TypeSpec{Kind: "string"}, Required: true},
			{Name: "Method", JsonName: "method", ProtoField: "method", Type: TypeSpec{Kind: "string"}},
			{Name: "Port", JsonName: "port", ProtoField: "port", Type: TypeSpec{Kind: "int32"}},
		},
	})

	// --- Namespace resource specs (schemas/agentic/testresource/) ---

	writeJSON(t, filepath.Join(schemasDir, "agentic", "testresource", "testresource.json"), &TaskConfigSchema{
		Name:        "TestResourceSpec",
		Description: "A test resource spec.",
		ProtoType:   "ai.stigmer.agentic.testresource.v1.TestResourceSpec",
		ProtoFile:   "apis/ai/stigmer/agentic/testresource/v1/spec.proto",
		Fields: []*FieldSchema{
			{Name: "Name", JsonName: "name", ProtoField: "name", Type: TypeSpec{Kind: "string"}, Required: true},
			{Name: "Labels", JsonName: "labels", ProtoField: "labels",
				Type: TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "string"}}},
			{Name: "Tags", JsonName: "tags", ProtoField: "tags",
				Type: TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "string"}}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if len(g.taskConfigs) != 4 {
		t.Errorf("expected 4 task configs, got %d", len(g.taskConfigs))
	}
	if len(g.sharedTypes) != 1 {
		t.Errorf("expected 1 shared type, got %d", len(g.sharedTypes))
	}
	if len(g.resourceSpecs) != 1 {
		t.Errorf("expected 1 resource spec, got %d", len(g.resourceSpecs))
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	t.Run("task_files_valid_go", func(t *testing.T) {
		n := verifyGoFiles(t, outputDir)
		if n < 5 {
			t.Errorf("expected at least 5 generated files (4 tasks + helpers), got %d", n)
		}
	})

	t.Run("shared_type_files_valid_go", func(t *testing.T) {
		typesDir := filepath.Join(tmpDir, "sdk", "go", "gen", "types")
		n := verifyGoFiles(t, typesDir)
		if n < 1 {
			t.Errorf("expected at least 1 types file, got %d", n)
		}
	})

	t.Run("resource_spec_files_valid_go", func(t *testing.T) {
		resourceDir := filepath.Join(tmpDir, "sdk", "go", "gen", "testresource")
		n := verifyGoFiles(t, resourceDir)
		if n < 1 {
			t.Errorf("expected at least 1 resource args file, got %d", n)
		}
	})

	t.Run("task_files_contain_structs_and_methods", func(t *testing.T) {
		files, _ := filepath.Glob(filepath.Join(outputDir, "*.go"))
		foundStruct := false
		foundToProto := false
		foundFromProto := false
		for _, f := range files {
			data, _ := os.ReadFile(f)
			content := string(data)
			if strings.Contains(content, "type ScalarTaskConfig struct") {
				foundStruct = true
			}
			if strings.Contains(content, "func (c *ScalarTaskConfig) ToProto()") {
				foundToProto = true
			}
			if strings.Contains(content, "func (c *ScalarTaskConfig) FromProto(") {
				foundFromProto = true
			}
		}
		if !foundStruct {
			t.Error("ScalarTaskConfig struct not found in generated files")
		}
		if !foundToProto {
			t.Error("ScalarTaskConfig.ToProto method not found in generated files")
		}
		if !foundFromProto {
			t.Error("ScalarTaskConfig.FromProto method not found in generated files")
		}
	})

	t.Run("helpers_contain_utility_functions", func(t *testing.T) {
		data, err := os.ReadFile(filepath.Join(outputDir, "helpers.go"))
		if err != nil {
			t.Fatalf("helpers.go not found: %v", err)
		}
		content := string(data)
		if !strings.Contains(content, "func isEmpty(") {
			t.Error("isEmpty function not found in helpers.go")
		}
		if !strings.Contains(content, "func coerceToString(") {
			t.Error("coerceToString function not found in helpers.go")
		}
	})

	t.Run("resource_args_struct_generated", func(t *testing.T) {
		files, _ := filepath.Glob(filepath.Join(tmpDir, "sdk", "go", "gen", "testresource", "*.go"))
		found := false
		for _, f := range files {
			data, _ := os.ReadFile(f)
			if strings.Contains(string(data), "type TestResourceArgs struct") {
				found = true
				break
			}
		}
		if !found {
			t.Error("TestResourceArgs struct not found in generated resource files")
		}
	})

	t.Run("shared_type_struct_generated", func(t *testing.T) {
		files, _ := filepath.Glob(filepath.Join(tmpDir, "sdk", "go", "gen", "types", "*.go"))
		found := false
		for _, f := range files {
			data, _ := os.ReadFile(f)
			if strings.Contains(string(data), "type TestEndpoint struct") {
				found = true
				break
			}
		}
		if !found {
			t.Error("TestEndpoint struct not found in generated types files")
		}
	})
}

// TestIntegrationMessageArrayAndMapValues exercises schemas with arrays of
// messages and maps with message values, which trigger the most complex
// import-tracking and conversion code paths.
func TestIntegrationMessageArrayAndMapValues(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	writeJSON(t, filepath.Join(schemasDir, "types", "item.json"), &TypeSchema{
		Name:        "TestItem",
		Description: "A test item type.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.TestItem",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/types.proto",
		Fields: []*FieldSchema{
			{Name: "Id", JsonName: "id", ProtoField: "id", Type: TypeSpec{Kind: "string"}},
			{Name: "Value", JsonName: "value", ProtoField: "value", Type: TypeSpec{Kind: "int32"}},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "tasks", "nested.json"), &TaskConfigSchema{
		Name:        "NestedTaskConfig",
		Kind:        "NESTED",
		Description: "Task with message arrays and map-of-message values.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.NestedTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/nested.proto",
		Fields: []*FieldSchema{
			{Name: "Items", JsonName: "items", ProtoField: "items",
				Type: TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "message", MessageType: "TestItem"}}},
			{Name: "NamedItems", JsonName: "namedItems", ProtoField: "named_items",
				Type: TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "message", MessageType: "TestItem"}}},
			{Name: "Label", JsonName: "label", ProtoField: "label", Type: TypeSpec{Kind: "string"}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	n := verifyGoFiles(t, outputDir)
	if n < 2 {
		t.Errorf("expected at least 2 task output files (nested + helpers), got %d", n)
	}

	typesDir := filepath.Join(tmpDir, "sdk", "go", "gen", "types")
	tn := verifyGoFiles(t, typesDir)
	if tn < 1 {
		t.Errorf("expected at least 1 types file, got %d", tn)
	}
}

// TestIntegrationEnumFields exercises schemas with enum type fields.
func TestIntegrationEnumFields(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	writeJSON(t, filepath.Join(schemasDir, "tasks", "enum.json"), &TaskConfigSchema{
		Name:        "EnumTaskConfig",
		Kind:        "ENUM",
		Description: "Task with enum fields.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.EnumTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/enum.proto",
		Fields: []*FieldSchema{
			{Name: "Mode", JsonName: "mode", ProtoField: "mode",
				Type: TypeSpec{Kind: "string", EnumType: "ai.stigmer.agentic.workflow.v1.Mode", EnumValues: []string{"fast", "slow", "balanced"}}},
			{Name: "Name", JsonName: "name", ProtoField: "name", Type: TypeSpec{Kind: "string"}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	n := verifyGoFiles(t, outputDir)
	if n < 2 {
		t.Errorf("expected at least 2 files (enum task + helpers), got %d", n)
	}
}

// TestIntegrationRealSchemas runs the generator against the actual production
// schemas directory. This catches regressions when schemas are added or changed.
func TestIntegrationRealSchemas(t *testing.T) {
	realSchemasDir := filepath.Join("..", "..", "..", "tools", "codegen", "schemas")
	if _, err := os.Stat(realSchemasDir); os.IsNotExist(err) {
		t.Skip("real schemas directory not found, skipping")
	}

	absSchemasDir, err := filepath.Abs(realSchemasDir)
	if err != nil {
		t.Fatal(err)
	}

	tmpDir := t.TempDir()
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	g, err := NewGenerator(absSchemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator with real schemas: %v", err)
	}

	if len(g.taskConfigs) == 0 && len(g.resourceSpecs) == 0 {
		t.Fatal("expected at least some task configs or resource specs from real schemas")
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate with real schemas: %v", err)
	}

	taskCount := verifyGoFiles(t, outputDir)
	if taskCount < 1 {
		t.Errorf("expected at least 1 generated file from real schemas, got %d", taskCount)
	}

	typesDir := filepath.Join(tmpDir, "sdk", "go", "gen", "types")
	if _, err := os.Stat(typesDir); err == nil {
		verifyGoFiles(t, typesDir)
	}

	genDir := filepath.Join(tmpDir, "sdk", "go", "gen")
	if _, err := os.Stat(genDir); err == nil {
		totalFiles := verifyGoFiles(t, genDir)
		t.Logf("Real schemas: generated %d task files + %d total gen/ files", taskCount, totalFiles)
	}
}

// TestIntegrationFileSuffix verifies the --file-suffix flag works correctly.
func TestIntegrationFileSuffix(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	writeJSON(t, filepath.Join(schemasDir, "tasks", "tiny.json"), &TaskConfigSchema{
		Name:        "TinyTaskConfig",
		Kind:        "TINY",
		Description: "Tiny task.",
		ProtoType:   "ai.stigmer.agentic.workflow.v1.tasks.TinyTaskConfig",
		ProtoFile:   "apis/ai/stigmer/agentic/workflow/v1/tasks/tiny.proto",
		Fields: []*FieldSchema{
			{Name: "Value", JsonName: "value", ProtoField: "value", Type: TypeSpec{Kind: "string"}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "_task")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	files, _ := filepath.Glob(filepath.Join(outputDir, "*_task.go"))
	if len(files) == 0 {
		allFiles, _ := filepath.Glob(filepath.Join(outputDir, "*.go"))
		t.Errorf("expected at least one file with _task suffix, got files: %v", allFiles)
	}

	verifyGoFiles(t, outputDir)
}

// TestIntegrationMultipleResourceSubdomains verifies generation for specs in
// multiple namespace/subdomain directories.
func TestIntegrationMultipleResourceSubdomains(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	writeJSON(t, filepath.Join(schemasDir, "agentic", "alpha", "alpha.json"), &TaskConfigSchema{
		Name:        "AlphaSpec",
		Description: "Alpha resource.",
		ProtoType:   "ai.stigmer.agentic.alpha.v1.AlphaSpec",
		ProtoFile:   "apis/ai/stigmer/agentic/alpha/v1/spec.proto",
		Fields: []*FieldSchema{
			{Name: "Name", JsonName: "name", ProtoField: "name", Type: TypeSpec{Kind: "string"}, Required: true},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "iam", "beta", "beta.json"), &TaskConfigSchema{
		Name:        "BetaSpec",
		Description: "Beta resource.",
		ProtoType:   "ai.stigmer.iam.beta.v1.BetaSpec",
		ProtoFile:   "apis/ai/stigmer/iam/beta/v1/spec.proto",
		Fields: []*FieldSchema{
			{Name: "Id", JsonName: "id", ProtoField: "id", Type: TypeSpec{Kind: "string"}},
			{Name: "Enabled", JsonName: "enabled", ProtoField: "enabled", Type: TypeSpec{Kind: "bool"}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if len(g.resourceSpecs) != 2 {
		t.Fatalf("expected 2 resource specs, got %d", len(g.resourceSpecs))
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	alphaDir := filepath.Join(tmpDir, "sdk", "go", "gen", "alpha")
	betaDir := filepath.Join(tmpDir, "sdk", "go", "gen", "beta")

	an := verifyGoFiles(t, alphaDir)
	if an < 1 {
		t.Errorf("expected at least 1 file in alpha/, got %d", an)
	}
	bn := verifyGoFiles(t, betaDir)
	if bn < 1 {
		t.Errorf("expected at least 1 file in beta/, got %d", bn)
	}

	checkArgsStruct := func(dir, structName string) {
		t.Helper()
		files, _ := filepath.Glob(filepath.Join(dir, "*.go"))
		found := false
		for _, f := range files {
			data, _ := os.ReadFile(f)
			if strings.Contains(string(data), "type "+structName+" struct") {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("struct %s not found in %s", structName, dir)
		}
	}

	checkArgsStruct(alphaDir, "AlphaArgs")
	checkArgsStruct(betaDir, "BetaArgs")
}

// TestIntegrationResourceWithSharedTypes verifies that resource specs can
// reference shared types and the generated code is still valid Go syntax.
func TestIntegrationResourceWithSharedTypes(t *testing.T) {
	tmpDir := t.TempDir()
	schemasDir := filepath.Join(tmpDir, "schemas")
	outputDir := filepath.Join(tmpDir, "output")

	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(origDir)

	writeJSON(t, filepath.Join(schemasDir, "agentic", "resref", "types", "reftype.json"), &TypeSchema{
		Name:        "RefType",
		Description: "A referenced type.",
		ProtoType:   "ai.stigmer.agentic.resref.v1.RefType",
		ProtoFile:   "apis/ai/stigmer/agentic/resref/v1/types.proto",
		Fields: []*FieldSchema{
			{Name: "Key", JsonName: "key", ProtoField: "key", Type: TypeSpec{Kind: "string"}},
		},
	})

	writeJSON(t, filepath.Join(schemasDir, "agentic", "resref", "resref.json"), &TaskConfigSchema{
		Name:        "ResRefSpec",
		Description: "Resource referencing a shared type.",
		ProtoType:   "ai.stigmer.agentic.resref.v1.ResRefSpec",
		ProtoFile:   "apis/ai/stigmer/agentic/resref/v1/spec.proto",
		Fields: []*FieldSchema{
			{Name: "Name", JsonName: "name", ProtoField: "name", Type: TypeSpec{Kind: "string"}},
			{Name: "Refs", JsonName: "refs", ProtoField: "refs",
				Type: TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "message", MessageType: "RefType"}}},
		},
	})

	g, err := NewGenerator(schemasDir, outputDir, "gen", "")
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}

	if err := g.Generate(); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	resDir := filepath.Join(tmpDir, "sdk", "go", "gen", "resref")
	verifyGoFiles(t, resDir)

	typesDir := filepath.Join(tmpDir, "sdk", "go", "gen", "types")
	verifyGoFiles(t, typesDir)
}
