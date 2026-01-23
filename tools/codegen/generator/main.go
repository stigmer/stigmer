// generator converts JSON schemas to Go code for the Stigmer SDK.
//
// This tool reads JSON schema files and generates:
// - Config structs for workflow tasks
// - Builder functions for creating tasks
// - ToProto/FromProto conversion methods
//
// Usage:
//   go run tools/codegen/generator/main.go \
//     --schema-dir tools/codegen/schemas \
//     --output-dir sdk/go/workflow/gen \
//     --package gen

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ============================================================================
// Schema Types
// ============================================================================

// TaskConfigSchema represents a workflow task configuration
type TaskConfigSchema struct {
	Name        string         `json:"name"`
	Kind        string         `json:"kind,omitempty"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

// TypeSchema represents a shared type (e.g., HttpEndpoint)
type TypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

// FieldSchema represents a field in a config or type
type FieldSchema struct {
	Name        string      `json:"name"`
	JsonName    string      `json:"jsonName"`
	ProtoField  string      `json:"protoField"`
	Type        TypeSpec    `json:"type"`
	Description string      `json:"description"`
	Required    bool        `json:"required"`
	Validation  *Validation `json:"validation,omitempty"`
}

// TypeSpec describes the type of a field
type TypeSpec struct {
	Kind        string    `json:"kind"`                  // string, int32, int64, bool, float, double, bytes, map, array, message, struct
	KeyType     *TypeSpec `json:"keyType,omitempty"`     // for map
	ValueType   *TypeSpec `json:"valueType,omitempty"`   // for map
	ElementType *TypeSpec `json:"elementType,omitempty"` // for array
	MessageType string    `json:"messageType,omitempty"` // for message
}

// Validation describes validation rules for a field
type Validation struct {
	Required  bool     `json:"required,omitempty"`
	MinLength int      `json:"minLength,omitempty"`
	MaxLength int      `json:"maxLength,omitempty"`
	Pattern   string   `json:"pattern,omitempty"`
	Min       int      `json:"min,omitempty"`
	Max       int      `json:"max,omitempty"`
	MinItems  int      `json:"minItems,omitempty"`
	MaxItems  int      `json:"maxItems,omitempty"`
	Enum      []string `json:"enum,omitempty"`
}

// ============================================================================
// Generator
// ============================================================================

// Generator generates Go code from JSON schemas
type Generator struct {
	schemaDir   string
	outputDir   string
	packageName string
	fileSuffix  string

	// Loaded schemas
	taskConfigs   []*TaskConfigSchema
	sharedTypes   []*TypeSchema
	resourceSpecs []*TaskConfigSchema // SDK resource specs (Agent, Skill, etc.) - reuses TaskConfigSchema
}

// NewGenerator creates a new code generator
func NewGenerator(schemaDir, outputDir, packageName, fileSuffix string) (*Generator, error) {
	g := &Generator{
		schemaDir:   schemaDir,
		outputDir:   outputDir,
		packageName: packageName,
		fileSuffix:  fileSuffix,
	}

	// Load schemas
	if err := g.loadSchemas(); err != nil {
		return nil, fmt.Errorf("failed to load schemas: %w", err)
	}

	return g, nil
}

// Generate generates all Go code
func (g *Generator) Generate() error {
	// Create output directory
	if err := os.MkdirAll(g.outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Generate helpers file first
	fmt.Printf("\nGenerating helpers...\n")
	if err := g.generateHelpers(); err != nil {
		return fmt.Errorf("failed to generate helpers: %w", err)
	}

	// Generate shared types
	if len(g.sharedTypes) > 0 {
		fmt.Printf("\nGenerating shared types...\n")
		if err := g.generateSharedTypes(); err != nil {
			return fmt.Errorf("failed to generate shared types: %w", err)
		}
	}

	// Generate task files (one file per task)
	fmt.Printf("\nGenerating task configs...\n")
	for _, taskConfig := range g.taskConfigs {
		if err := g.generateTaskFile(taskConfig); err != nil {
			return fmt.Errorf("failed to generate task %s: %w", taskConfig.Name, err)
		}
	}

	// Generate SDK resource options (Agent, Skill, etc.)
	if len(g.resourceSpecs) > 0 {
		fmt.Printf("\nGenerating SDK resource options...\n")
		for _, resourceSpec := range g.resourceSpecs {
			if err := g.generateResourceOptionsFile(resourceSpec); err != nil {
				return fmt.Errorf("failed to generate resource options for %s: %w", resourceSpec.Name, err)
			}
		}
	}

	return nil
}

// getOutputDir returns the appropriate output directory for a given schema
func (g *Generator) getOutputDir(schema *TaskConfigSchema) string {
	// Check if this is an agent spec
	if strings.Contains(schema.ProtoFile, "/agent/") {
		return "sdk/go/agent/gen"
	}
	
	// Check if this is a skill spec
	if strings.Contains(schema.ProtoFile, "/skill/") {
		return "sdk/go/skill/gen"
	}
	
	// Default: workflow tasks
	return g.outputDir
}

// loadSchemas loads all JSON schemas from the schema directory
func (g *Generator) loadSchemas() error {
	// Try loading from tasks/ subdirectory first
	tasksDir := filepath.Join(g.schemaDir, "tasks")
	if _, err := os.Stat(tasksDir); err == nil {
		entries, err := os.ReadDir(tasksDir)
		if err != nil {
			return fmt.Errorf("failed to read tasks directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(tasksDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load task config %s: %w", entry.Name(), err)
			}

			g.taskConfigs = append(g.taskConfigs, schema)
			fmt.Printf("  Loaded config: %s\n", schema.Name)
		}
	} else {
		// If no tasks/ subdirectory, load from root schema directory
		entries, err := os.ReadDir(g.schemaDir)
		if err != nil {
			return fmt.Errorf("failed to read schema directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(g.schemaDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load config %s: %w", entry.Name(), err)
			}

			g.taskConfigs = append(g.taskConfigs, schema)
			fmt.Printf("  Loaded config: %s\n", schema.Name)
		}
	}

	// Load shared types
	typesDir := filepath.Join(g.schemaDir, "types")
	if _, err := os.Stat(typesDir); err == nil {
		entries, err := os.ReadDir(typesDir)
		if err != nil {
			return fmt.Errorf("failed to read types directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(typesDir, entry.Name())
			schema, err := loadTypeSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load type %s: %w", entry.Name(), err)
			}

			g.sharedTypes = append(g.sharedTypes, schema)
			fmt.Printf("  Loaded type: %s\n", schema.Name)
		}
	}

	// Load SDK resource specs (Agent, Skill, etc.)
	// Try agent/ subdirectory
	agentDir := filepath.Join(g.schemaDir, "agent")
	if _, err := os.Stat(agentDir); err == nil {
		entries, err := os.ReadDir(agentDir)
		if err != nil {
			return fmt.Errorf("failed to read agent directory: %w", err)
		}

		for _, entry := range entries {
			// Skip subdirectories and non-JSON files
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(agentDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load agent spec %s: %w", entry.Name(), err)
			}

			g.resourceSpecs = append(g.resourceSpecs, schema)
			fmt.Printf("  Loaded spec: %s\n", schema.Name)
		}
	}

	// Try skill/ subdirectory
	skillDir := filepath.Join(g.schemaDir, "skill")
	if _, err := os.Stat(skillDir); err == nil {
		entries, err := os.ReadDir(skillDir)
		if err != nil {
			return fmt.Errorf("failed to read skill directory: %w", err)
		}

		for _, entry := range entries {
			// Skip subdirectories and non-JSON files
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(skillDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load skill spec %s: %w", entry.Name(), err)
			}

			g.resourceSpecs = append(g.resourceSpecs, schema)
			fmt.Printf("  Loaded spec: %s\n", schema.Name)
		}
	}

	if len(g.taskConfigs) == 0 && len(g.sharedTypes) == 0 && len(g.resourceSpecs) == 0 {
		return fmt.Errorf("no schemas found in %s", g.schemaDir)
	}

	return nil
}

// loadTaskConfigSchema loads a task config schema from a JSON file
func loadTaskConfigSchema(path string) (*TaskConfigSchema, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var schema TaskConfigSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, err
	}

	return &schema, nil
}

// loadTypeSchema loads a type schema from a JSON file
func loadTypeSchema(path string) (*TypeSchema, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var schema TypeSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, err
	}

	return &schema, nil
}

// generateHelpers generates a helpers.go file with utility functions
func (g *Generator) generateHelpers() error {
	var buf bytes.Buffer

	// File header
	fmt.Fprintf(&buf, "// Code generated by stigmer-codegen. DO NOT EDIT.\n")
	fmt.Fprintf(&buf, "// Generated: %s\n\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Import reflect and fmt
	fmt.Fprintf(&buf, "import (\n")
	fmt.Fprintf(&buf, "\t\"fmt\"\n")
	fmt.Fprintf(&buf, "\t\"reflect\"\n")
	fmt.Fprintf(&buf, ")\n\n")

	// isEmpty function
	fmt.Fprintf(&buf, "// isEmpty checks if a value is empty/zero.\n")
	fmt.Fprintf(&buf, "// Used by ToProto methods to skip optional fields.\n")
	fmt.Fprintf(&buf, "func isEmpty(v interface{}) bool {\n")
	fmt.Fprintf(&buf, "\tif v == nil {\n")
	fmt.Fprintf(&buf, "\t\treturn true\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\tval := reflect.ValueOf(v)\n")
	fmt.Fprintf(&buf, "\treturn val.IsZero()\n")
	fmt.Fprintf(&buf, "}\n\n")

	// coerceToString function for expression support
	fmt.Fprintf(&buf, "// coerceToString converts various types to strings for expression support.\n")
	fmt.Fprintf(&buf, "// Used by option functions to accept both string literals and expressions.\n")
	fmt.Fprintf(&buf, "func coerceToString(value interface{}) string {\n")
	fmt.Fprintf(&buf, "\tif s, ok := value.(string); ok {\n")
	fmt.Fprintf(&buf, "\t\treturn s\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\t// Handle TaskFieldRef and other expression types\n")
	fmt.Fprintf(&buf, "\tif expr, ok := value.(interface{ Expression() string }); ok {\n")
	fmt.Fprintf(&buf, "\t\treturn expr.Expression()\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\treturn fmt.Sprintf(\"%%v\", value)\n")
	fmt.Fprintf(&buf, "}\n")

	// Format and write
	fmt.Printf("  Generating helpers.go...\n")
	return g.writeFormattedFile("helpers.go", buf.Bytes())
}

// generateSharedTypes generates a types.go file with all shared types
func (g *Generator) generateSharedTypes() error {
	ctx := newGenContext(g.packageName)

	var buf bytes.Buffer

	// Generate package declaration
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate each shared type
	for _, typeSchema := range g.sharedTypes {
		if err := ctx.genTypeStruct(&buf, typeSchema); err != nil {
			return err
		}

		// Generate FromProto method for shared types
		if err := ctx.genTypeFromProtoMethod(&buf, typeSchema); err != nil {
			return err
		}
	}

	// Add imports at the beginning
	var finalBuf bytes.Buffer
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: types.go\n"))
	finalBuf.WriteString(fmt.Sprintf("// Generated: %s\n\n", time.Now().Format(time.RFC3339)))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", g.packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+g.packageName+"\n\n"):])

	// Format and write
	fmt.Printf("  Generating types.go...\n")
	return g.writeFormattedFile("types.go", finalBuf.Bytes())
}

// generateTaskFile generates a single file for a task config
func (g *Generator) generateTaskFile(taskConfig *TaskConfigSchema) error {
	ctx := newGenContext(g.packageName)

	var buf bytes.Buffer

	// Generate package and imports
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate config struct
	if err := ctx.genConfigStruct(&buf, taskConfig); err != nil {
		return err
	}

	// Generate ToProto method
	if err := ctx.genToProtoMethod(&buf, taskConfig); err != nil {
		return err
	}

	// Generate FromProto method
	if err := ctx.genFromProtoMethod(&buf, taskConfig); err != nil {
		return err
	}

	// Generate functional options (NEW)
	if err := ctx.genOptions(&buf, taskConfig); err != nil {
		return err
	}

	// Add imports at the beginning (after package declaration)
	var finalBuf bytes.Buffer
	baseName := strings.ToLower(strings.ReplaceAll(taskConfig.Name, "Spec", "spec"))
	baseName = strings.ToLower(strings.ReplaceAll(baseName, "Config", "config"))
	filename := fmt.Sprintf("%s%s.go", toSnakeCase(baseName), g.fileSuffix)
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n", filename))
	finalBuf.WriteString(fmt.Sprintf("// Generated: %s\n\n", time.Now().Format(time.RFC3339)))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", g.packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+g.packageName+"\n\n"):])

	// Format and write
	fmt.Printf("  Generating %s...\n", filename)
	return g.writeFormattedFile(filename, finalBuf.Bytes())
}

// generateResourceOptionsFile generates only the options for an SDK resource spec
// (struct and proto methods already exist, so we only generate options)
func (g *Generator) generateResourceOptionsFile(resourceSpec *TaskConfigSchema) error {
	ctx := newGenContext(g.packageName)

	var buf bytes.Buffer

	// Generate package declaration
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate functional options only
	if err := ctx.genOptions(&buf, resourceSpec); err != nil {
		return err
	}

	// Add imports at the beginning (after package declaration)
	var finalBuf bytes.Buffer
	baseName := strings.ToLower(strings.ReplaceAll(resourceSpec.Name, "Spec", "spec"))
	filename := fmt.Sprintf("%s_options.go", toSnakeCase(baseName))
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n", filename))
	finalBuf.WriteString(fmt.Sprintf("// Generated: %s\n\n", time.Now().Format(time.RFC3339)))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", g.packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+g.packageName+"\n\n"):])

	// Format and write
	outputDir := g.getOutputDir(resourceSpec)
	fmt.Printf("  Generating %s/%s...\n", outputDir, filename)
	return g.writeFormattedFileToDir(outputDir, filename, finalBuf.Bytes())
}

// writeFormattedFile formats Go code and writes it to a file
func (g *Generator) writeFormattedFile(filename string, code []byte) error {
	return g.writeFormattedFileToDir(g.outputDir, filename, code)
}

// writeFormattedFileToDir formats Go code and writes it to a file in a specific directory
func (g *Generator) writeFormattedFileToDir(outputDir, filename string, code []byte) error {
	// Format with gofmt
	formatted, err := format.Source(code)
	if err != nil {
		// Print the code for debugging
		fmt.Printf("\n=== UNFORMATTED CODE (contains errors) ===\n%s\n", string(code))
		return fmt.Errorf("failed to format %s: %w", filename, err)
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", outputDir, err)
	}

	// Write to file
	outputPath := filepath.Join(outputDir, filename)
	if err := os.WriteFile(outputPath, formatted, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", filename, err)
	}

	return nil
}

// ============================================================================
// Generation Context
// ============================================================================

// genContext holds state during code generation
type genContext struct {
	packageName string
	imports     map[string]struct{}
	generated   map[string]struct{}
}

// newGenContext creates a new generation context
func newGenContext(packageName string) *genContext {
	return &genContext{
		packageName: packageName,
		imports:     make(map[string]struct{}),
		generated:   make(map[string]struct{}),
	}
}

// addImport adds an import to the context
func (c *genContext) addImport(pkg string) {
	c.imports[pkg] = struct{}{}
}

// genImports generates the import block
func (c *genContext) genImports(w *bytes.Buffer) {
	if len(c.imports) == 0 {
		return
	}

	// Sort imports for deterministic output
	imports := make([]string, 0, len(c.imports))
	for imp := range c.imports {
		imports = append(imports, imp)
	}
	sort.Strings(imports)

	// Write import block
	fmt.Fprintf(w, "import (\n")
	for _, imp := range imports {
		fmt.Fprintf(w, "\t\"%s\"\n", imp)
	}
	fmt.Fprintf(w, ")\n\n")
}

// genConfigStruct generates a Go struct for a task config
func (c *genContext) genConfigStruct(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Generate documentation comment
	if config.Description != "" {
		c.writeComment(w, config.Description)
	}

	// Struct declaration
	fmt.Fprintf(w, "type %s struct {\n", config.Name)

	// Fields
	for _, field := range config.Fields {
		// Field comment
		if field.Description != "" {
			c.writeFieldComment(w, field.Description)
		}

		// Field declaration
		goType := c.goType(field.Type)
		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")

	// Generate isTaskConfig() method only for TaskConfig types (backwards compatibility)
	if strings.HasSuffix(config.Name, "TaskConfig") {
		fmt.Fprintf(w, "// isTaskConfig marks %s as a TaskConfig implementation.\n", config.Name)
		fmt.Fprintf(w, "func (c *%s) isTaskConfig() {}\n\n", config.Name)
	}

	return nil
}

// genTypeStruct generates a Go struct for a shared type
func (c *genContext) genTypeStruct(w *bytes.Buffer, typeSchema *TypeSchema) error {
	// Generate documentation comment
	if typeSchema.Description != "" {
		c.writeComment(w, typeSchema.Description)
	}

	// Struct declaration
	fmt.Fprintf(w, "type %s struct {\n", typeSchema.Name)

	// Fields
	for _, field := range typeSchema.Fields {
		// Field comment
		if field.Description != "" {
			c.writeFieldComment(w, field.Description)
		}

		// Field declaration
		goType := c.goType(field.Type)
		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")
	return nil
}

// genBuilderFunc generates a builder function for a task config.
//
// DEPRECATED: This method is no longer used. Builder functions are now
// part of the manual ergonomic API layer (workflow.go and *_options.go),
// not generated code, because they reference manual SDK types like *Task.
//
// This method is kept for reference but should not be called.
func (c *genContext) genBuilderFunc(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Function documentation
	kindTitle := strings.Title(strings.ToLower(strings.ReplaceAll(config.Kind, "_", " ")))
	fmt.Fprintf(w, "// %sTask creates a %s workflow task.\n", titleCase(config.Kind), kindTitle)
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Parameters:\n")
	fmt.Fprintf(w, "//   - name: Task name (must be unique within workflow)\n")
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		desc := sanitizeDescription(field.Description)
		fmt.Fprintf(w, "//   - %s: %s\n", paramName, desc)
	}
	fmt.Fprintf(w, "func %sTask(name string", titleCase(config.Kind))

	// Parameters
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		paramType := c.goType(field.Type)
		fmt.Fprintf(w, ", %s %s", paramName, paramType)
	}

	fmt.Fprintf(w, ") *Task {\n")

	// Function body
	fmt.Fprintf(w, "\treturn &Task{\n")
	fmt.Fprintf(w, "\t\tName: name,\n")
	fmt.Fprintf(w, "\t\tKind: TaskKind%s,\n", titleCase(config.Kind))
	fmt.Fprintf(w, "\t\tConfig: &%s{\n", config.Name)

	// Assign parameters to struct fields
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		fmt.Fprintf(w, "\t\t\t%s: %s,\n", field.Name, paramName)
	}

	fmt.Fprintf(w, "\t\t},\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genToProtoMethod generates ToProto() method for proto conversion
func (c *genContext) genToProtoMethod(w *bytes.Buffer, config *TaskConfigSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// ToProto converts %s to google.protobuf.Struct for proto marshaling.\n", config.Name)
	fmt.Fprintf(w, "func (c *%s) ToProto() (*structpb.Struct, error) {\n", config.Name)
	fmt.Fprintf(w, "\tdata := make(map[string]interface{})\n\n")

	// Marshal each field
	for _, field := range config.Fields {
		if field.Required {
			fmt.Fprintf(w, "\tdata[\"%s\"] = c.%s\n", field.JsonName, field.Name)
		} else {
			// Optional field - only include if not zero value
			fmt.Fprintf(w, "\tif !isEmpty(c.%s) {\n", field.Name)
			fmt.Fprintf(w, "\t\tdata[\"%s\"] = c.%s\n", field.JsonName, field.Name)
			fmt.Fprintf(w, "\t}\n")
		}
	}

	fmt.Fprintf(w, "\n\treturn structpb.NewStruct(data)\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genTypeFromProtoMethod generates FromProto() method for a shared type
func (c *genContext) genTypeFromProtoMethod(w *bytes.Buffer, typeSchema *TypeSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// FromProto converts google.protobuf.Struct to %s.\n", typeSchema.Name)
	fmt.Fprintf(w, "func (c *%s) FromProto(s *structpb.Struct) error {\n", typeSchema.Name)
	fmt.Fprintf(w, "\tfields := s.GetFields()\n\n")

	// Unmarshal each field
	for _, field := range typeSchema.Fields {
		c.genFromProtoField(w, field)
	}

	fmt.Fprintf(w, "\treturn nil\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genFromProtoMethod generates FromProto() method for proto conversion
func (c *genContext) genFromProtoMethod(w *bytes.Buffer, config *TaskConfigSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// FromProto converts google.protobuf.Struct to %s.\n", config.Name)
	fmt.Fprintf(w, "func (c *%s) FromProto(s *structpb.Struct) error {\n", config.Name)
	fmt.Fprintf(w, "\tfields := s.GetFields()\n\n")

	// Unmarshal each field
	for _, field := range config.Fields {
		c.genFromProtoField(w, field)
	}

	fmt.Fprintf(w, "\treturn nil\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genFromProtoField generates FromProto conversion code for a single field
func (c *genContext) genFromProtoField(w *bytes.Buffer, field *FieldSchema) {
	fmt.Fprintf(w, "\tif val, ok := fields[\"%s\"]; ok {\n", field.JsonName)

	switch field.Type.Kind {
	case "string":
		fmt.Fprintf(w, "\t\tc.%s = val.GetStringValue()\n", field.Name)

	case "int32":
		fmt.Fprintf(w, "\t\tc.%s = int32(val.GetNumberValue())\n", field.Name)

	case "int64":
		fmt.Fprintf(w, "\t\tc.%s = int64(val.GetNumberValue())\n", field.Name)

	case "bool":
		fmt.Fprintf(w, "\t\tc.%s = val.GetBoolValue()\n", field.Name)

	case "map":
		if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "string" {
			fmt.Fprintf(w, "\t\tc.%s = make(map[string]string)\n", field.Name)
			fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
			fmt.Fprintf(w, "\t\t\tc.%s[k] = v.GetStringValue()\n", field.Name)
			fmt.Fprintf(w, "\t\t}\n")
		} else {
			// TODO: Implement FromProto for complex map fields
			fmt.Fprintf(w, "\t\t// TODO: Implement FromProto for map field %s\n", field.Name)
			fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
		}

	case "struct":
		fmt.Fprintf(w, "\t\tc.%s = val.GetStructValue().AsMap()\n", field.Name)

	case "message":
		fmt.Fprintf(w, "\t\tc.%s = &%s{}\n", field.Name, field.Type.MessageType)
		fmt.Fprintf(w, "\t\tif err := c.%s.FromProto(val.GetStructValue()); err != nil {\n", field.Name)
		fmt.Fprintf(w, "\t\t\treturn err\n")
		fmt.Fprintf(w, "\t\t}\n")

	case "array":
		// TODO: Implement array FromProto conversion based on element type
		// For now, skip array fields in FromProto (they're typically output-only)
		fmt.Fprintf(w, "\t\t// TODO: Implement FromProto for array field %s\n", field.Name)
		fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")

	default:
		// For unknown types, suppress unused variable warning
		fmt.Fprintf(w, "\t\t// TODO: Implement FromProto for %s field %s\n", field.Type.Kind, field.Name)
		fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
	}

	fmt.Fprintf(w, "\t}\n\n")
}

// ============================================================================
// Options Generation
// ============================================================================

// genOptions generates functional options for a task config
func (c *genContext) genOptions(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Determine if this is a task config or SDK resource
	isTaskConfig := strings.HasSuffix(config.Name, "TaskConfig")
	isResourceSpec := strings.HasSuffix(config.Name, "Spec")
	
	// Only generate options for task configs or SDK resource specs (not shared types)
	if !isTaskConfig && !isResourceSpec {
		return nil
	}

	// Generate option type
	if err := c.genOptionType(w, config); err != nil {
		return err
	}

	// Generate builder function (only for task configs, not SDK resources)
	if isTaskConfig {
		if err := c.genBuilderFunction(w, config); err != nil {
			return err
		}
	}

	// Generate field setter functions
	if err := c.genFieldSetters(w, config); err != nil {
		return err
	}

	return nil
}

// genOptionType generates the option function type declaration
func (c *genContext) genOptionType(w *bytes.Buffer, config *TaskConfigSchema) error {
	optionTypeName := c.getOptionTypeName(config)

	// Generate appropriate documentation based on whether this is a task or SDK resource
	if strings.HasSuffix(config.Name, "TaskConfig") {
		fmt.Fprintf(w, "// %s is a functional option for configuring a %s task.\n",
			optionTypeName, config.Kind)
	} else {
		// SDK resource (Agent, Skill, etc.)
		resourceName := strings.TrimSuffix(config.Name, "Spec")
		fmt.Fprintf(w, "// %s is a functional option for configuring a %s.\n",
			optionTypeName, resourceName)
	}
	
	fmt.Fprintf(w, "type %s func(*%s)\n\n", optionTypeName, config.Name)

	return nil
}

// genBuilderFunction generates the main builder function
func (c *genContext) genBuilderFunction(w *bytes.Buffer, config *TaskConfigSchema) error {
	optionTypeName := c.getOptionTypeName(config)
	builderName := c.getBuilderName(config)

	// Function documentation
	fmt.Fprintf(w, "// %s creates a %s task with functional options.\n", builderName, config.Kind)
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\ttask := %s(\"my-task\",\n", builderName)

	// Add example options for first few fields
	exampleCount := 0
	for _, field := range config.Fields {
		if exampleCount >= 2 {
			break
		}
		if field.Type.Kind == "string" || field.Type.Kind == "int32" {
			fmt.Fprintf(w, "//\t    %s(...),\n", field.Name)
			exampleCount++
		}
	}
	fmt.Fprintf(w, "//\t)\n")

	// Function signature
	fmt.Fprintf(w, "func %s(name string, opts ...%s) *Task {\n", builderName, optionTypeName)

	// Initialize config with empty maps
	fmt.Fprintf(w, "\tconfig := &%s{\n", config.Name)
	for _, field := range config.Fields {
		if field.Type.Kind == "map" {
			keyType := c.goType(*field.Type.KeyType)
			valueType := c.goType(*field.Type.ValueType)
			fmt.Fprintf(w, "\t\t%s: make(map[%s]%s),\n", field.Name, keyType, valueType)
		}
	}
	fmt.Fprintf(w, "\t}\n\n")

	// Apply options
	fmt.Fprintf(w, "\t// Apply all options\n")
	fmt.Fprintf(w, "\tfor _, opt := range opts {\n")
	fmt.Fprintf(w, "\t\topt(config)\n")
	fmt.Fprintf(w, "\t}\n\n")

	// Return Task
	fmt.Fprintf(w, "\treturn &Task{\n")
	fmt.Fprintf(w, "\t\tName:   name,\n")
	fmt.Fprintf(w, "\t\tKind:   TaskKind%s,\n", c.getTaskKindSuffix(config))
	fmt.Fprintf(w, "\t\tConfig: config,\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genFieldSetters generates option functions for all fields
func (c *genContext) genFieldSetters(w *bytes.Buffer, config *TaskConfigSchema) error {
	optionTypeName := c.getOptionTypeName(config)

	for _, field := range config.Fields {
		var err error

		// Handle different field types
		switch field.Type.Kind {
		case "map":
			// Generate singular + plural map options (e.g., Header/Headers)
			err = c.genMapFieldSetters(w, field, config, optionTypeName)
		case "array":
			// Generate singular + plural array options (e.g., Skill/Skills)
			err = c.genArrayFieldSetters(w, field, config, optionTypeName)
		default:
			// Handle simple field types (string, int, bool, struct)
			err = c.genFieldSetter(w, field, config)
		}

		if err != nil {
			return err
		}
	}
	return nil
}

// genFieldSetter generates a single field setter function
func (c *genContext) genFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema) error {
	optionTypeName := c.getOptionTypeName(config)

	switch field.Type.Kind {
	case "string":
		return c.genStringFieldSetter(w, field, config, optionTypeName)
	case "int32", "int64":
		return c.genIntFieldSetter(w, field, config, optionTypeName)
	case "bool":
		return c.genBoolFieldSetter(w, field, config, optionTypeName)
	case "struct", "message":
		return c.genStructFieldSetter(w, field, config, optionTypeName)
	default:
		// Skip unknown types
		return nil
	}
}

// genStringFieldSetter generates a setter for string fields
func (c *genContext) genStringFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s sets the %s.\n", field.Name, strings.ToLower(sanitizeDescription(field.Description)))
		fmt.Fprintf(w, "//\n")
	} else {
		fmt.Fprintf(w, "// %s sets the %s field.\n", field.Name, field.JsonName)
		fmt.Fprintf(w, "//\n")
	}

	fmt.Fprintf(w, "// Accepts:\n")
	fmt.Fprintf(w, "//   - String literal: \"value\"\n")
	fmt.Fprintf(w, "//   - Expression: \"${.variable}\"\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\t%s(\"example-value\")\n", field.Name)
	fmt.Fprintf(w, "//\t%s(\"${.config.value}\")\n", field.Name)

	// Function signature - use interface{} to support expressions
	fmt.Fprintf(w, "func %s(value interface{}) %s {\n", field.Name, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)
	fmt.Fprintf(w, "\t\tc.%s = coerceToString(value)\n", field.Name)
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genIntFieldSetter generates a setter for int32/int64 fields
func (c *genContext) genIntFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	goType := c.goType(field.Type)

	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s sets the %s.\n", field.Name, strings.ToLower(sanitizeDescription(field.Description)))
		fmt.Fprintf(w, "//\n")
	} else {
		fmt.Fprintf(w, "// %s sets the %s field.\n", field.Name, field.JsonName)
		fmt.Fprintf(w, "//\n")
	}

	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\t%s(30)\n", field.Name)

	// Function signature
	fmt.Fprintf(w, "func %s(value %s) %s {\n", field.Name, goType, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)
	fmt.Fprintf(w, "\t\tc.%s = value\n", field.Name)
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genBoolFieldSetter generates a setter for bool fields
func (c *genContext) genBoolFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s sets the %s.\n", field.Name, strings.ToLower(sanitizeDescription(field.Description)))
		fmt.Fprintf(w, "//\n")
	} else {
		fmt.Fprintf(w, "// %s sets the %s field.\n", field.Name, field.JsonName)
		fmt.Fprintf(w, "//\n")
	}

	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\t%s(true)\n", field.Name)

	// Function signature
	fmt.Fprintf(w, "func %s(value bool) %s {\n", field.Name, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)
	fmt.Fprintf(w, "\t\tc.%s = value\n", field.Name)
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genStructFieldSetter generates a setter for struct fields (google.protobuf.Struct)
func (c *genContext) genStructFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Determine the Go type for this field
	fieldGoType := c.goType(field.Type)
	
	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s sets the %s.\n", field.Name, strings.ToLower(sanitizeDescription(field.Description)))
		fmt.Fprintf(w, "//\n")
	} else{
		fmt.Fprintf(w, "// %s sets the %s field.\n", field.Name, field.JsonName)
		fmt.Fprintf(w, "//\n")
	}

	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	
	// Generate different examples based on whether this is a struct or message type
	if field.Type.Kind == "struct" {
		// For google.protobuf.Struct (map[string]interface{})
		fmt.Fprintf(w, "//\t%s(map[string]interface{}{\n", field.Name)
		fmt.Fprintf(w, "//\t    \"key\": \"value\",\n")
		fmt.Fprintf(w, "//\t})\n")
	} else {
		// For message types (e.g., *EnvironmentSpec)
		fmt.Fprintf(w, "//\t%s(&%s{...})\n", field.Name, field.Type.MessageType)
	}

	// Function signature - use the actual Go type
	fmt.Fprintf(w, "func %s(value %s) %s {\n", field.Name, fieldGoType, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)
	fmt.Fprintf(w, "\t\tc.%s = value\n", field.Name)
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genMapFieldSetters generates both singular and plural option functions for map fields.
// For a field like "Headers", generates:
//   - Header(key, value) - adds a single entry
//   - Headers(map) - adds multiple entries
//
// For fields already singular like "Env", only generates the plural form.
func (c *genContext) genMapFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	singularName := c.singularize(field.Name)
	pluralName := field.Name

	// If field name is already singular (singularize returns same name),
	// only generate singular version (it takes key/value like a singular function)
	if singularName == pluralName {
		// Field is already singular (e.g., "Env" not "Envs")
		// Generate only singular option that adds one entry
		return c.genSingularMapSetter(w, singularName, field, config, optionTypeName)
	}

	// Field is plural (e.g., "Headers")
	// Generate both singular (Header) and plural (Headers) options
	if err := c.genSingularMapSetter(w, singularName, field, config, optionTypeName); err != nil {
		return err
	}

	if err := c.genPluralMapSetter(w, pluralName, field, config, optionTypeName); err != nil {
		return err
	}

	return nil
}

// genSingularMapSetter generates a singular map option function.
// Example: Header(key, value interface{}) HttpCallOption
func (c *genContext) genSingularMapSetter(w *bytes.Buffer, funcName string, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Determine if values need coercion
	needsValueCoercion := c.needsCoercion(field.Type.ValueType)

	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s adds a single entry to %s.\n", funcName, strings.ToLower(sanitizeDescription(field.Description)))
	} else {
		fmt.Fprintf(w, "// %s adds a single entry to the %s map.\n", funcName, field.JsonName)
	}
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Accepts:\n")
	fmt.Fprintf(w, "//   - key: Map key (supports expressions)\n")
	fmt.Fprintf(w, "//   - value: Map value")
	if needsValueCoercion {
		fmt.Fprintf(w, " (supports expressions)")
	}
	fmt.Fprintf(w, "\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\t%s(\"key-name\", \"value\")\n", funcName)
	if needsValueCoercion {
		fmt.Fprintf(w, "//\t%s(\"dynamic-key\", \"${.variable}\")\n", funcName)
	}

	// Function signature - both key and value are interface{} for expression support
	fmt.Fprintf(w, "func %s(key, value interface{}) %s {\n", funcName, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)

	// Generate map assignment with appropriate coercion
	if needsValueCoercion {
		// Both key and value support expressions
		fmt.Fprintf(w, "\t\tc.%s[coerceToString(key)] = coerceToString(value)\n", field.Name)
	} else {
		// Only key needs coercion, value is used as-is
		fmt.Fprintf(w, "\t\tc.%s[coerceToString(key)] = value\n", field.Name)
	}

	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genPluralMapSetter generates a plural map option function.
// Example: Headers(headers map[string]interface{}) HttpCallOption
func (c *genContext) genPluralMapSetter(w *bytes.Buffer, funcName string, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Determine if values need coercion
	needsValueCoercion := c.needsCoercion(field.Type.ValueType)

	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s adds multiple entries to %s.\n", funcName, strings.ToLower(sanitizeDescription(field.Description)))
	} else {
		fmt.Fprintf(w, "// %s adds multiple entries to the %s map.\n", funcName, field.JsonName)
	}
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "//\t%s(map[string]interface{}{\n", funcName)
	fmt.Fprintf(w, "//\t    \"key1\": \"value1\",\n")
	if needsValueCoercion {
		fmt.Fprintf(w, "//\t    \"key2\": \"${.dynamicValue}\",\n")
	} else {
		fmt.Fprintf(w, "//\t    \"key2\": \"value2\",\n")
	}
	fmt.Fprintf(w, "//\t})\n")

	// Function signature - accept map[string]interface{} for flexibility
	fmt.Fprintf(w, "func %s(entries map[string]interface{}) %s {\n", funcName, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)
	fmt.Fprintf(w, "\t\tfor key, value := range entries {\n")

	// Generate map assignment with appropriate coercion
	if needsValueCoercion {
		fmt.Fprintf(w, "\t\t\tc.%s[coerceToString(key)] = coerceToString(value)\n", field.Name)
	} else {
		fmt.Fprintf(w, "\t\t\tc.%s[coerceToString(key)] = value\n", field.Name)
	}

	fmt.Fprintf(w, "\t\t}\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genArrayFieldSetters generates both singular and plural option functions for array fields.
// For a field like "Skills", generates:
//   - Skill(item) - adds a single item
//   - Skills(items) - adds multiple items
//
// For fields already singular, only generates the singular form.
func (c *genContext) genArrayFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	singularName := c.singularize(field.Name)
	pluralName := field.Name

	// If field name is already singular (singularize returns same name),
	// only generate singular version
	if singularName == pluralName {
		// Field is already singular (e.g., "Data" not "Datas")
		// Generate only singular option that adds one item
		return c.genSingularArraySetter(w, singularName, field, config, optionTypeName)
	}

	// Field is plural (e.g., "Skills")
	// Generate both singular (Skill) and plural (Skills) options
	if err := c.genSingularArraySetter(w, singularName, field, config, optionTypeName); err != nil {
		return err
	}

	if err := c.genPluralArraySetter(w, pluralName, field, config, optionTypeName); err != nil {
		return err
	}

	return nil
}

// genSingularArraySetter generates a singular array option function.
// Example: Skill(skill *SkillReference) AgentOption
func (c *genContext) genSingularArraySetter(w *bytes.Buffer, funcName string, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Get the element type
	elementType := c.goType(*field.Type.ElementType)

	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s adds a single item to %s.\n", funcName, strings.ToLower(sanitizeDescription(field.Description)))
	} else {
		fmt.Fprintf(w, "// %s adds a single item to the %s array.\n", funcName, field.JsonName)
	}
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")

	// Generate example based on element type
	if field.Type.ElementType.Kind == "string" {
		fmt.Fprintf(w, "//\t%s(\"item-value\")\n", funcName)
		fmt.Fprintf(w, "//\t%s(\"${.dynamicValue}\")\n", funcName)
	} else if field.Type.ElementType.Kind == "message" {
		fmt.Fprintf(w, "//\t%s(&%s{...})\n", funcName, field.Type.ElementType.MessageType)
	} else {
		fmt.Fprintf(w, "//\t%s(value)\n", funcName)
	}

	// Function signature - use the actual element type
	fmt.Fprintf(w, "func %s(item %s) %s {\n", funcName, elementType, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)

	// Append to slice
	fmt.Fprintf(w, "\t\tc.%s = append(c.%s, item)\n", field.Name, field.Name)

	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genPluralArraySetter generates a plural array option function.
// Example: Skills(skills []*SkillReference) AgentOption
func (c *genContext) genPluralArraySetter(w *bytes.Buffer, funcName string, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
	// Get the slice type (e.g., "[]*SkillReference" or "[]string")
	sliceType := c.goType(field.Type)

	// Generate documentation
	if field.Description != "" {
		fmt.Fprintf(w, "// %s adds multiple items to %s.\n", funcName, strings.ToLower(sanitizeDescription(field.Description)))
	} else{
		fmt.Fprintf(w, "// %s adds multiple items to the %s array.\n", funcName, field.JsonName)
	}
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Example:\n")
	fmt.Fprintf(w, "//\n")

	// Generate example based on element type
	if field.Type.ElementType.Kind == "string" {
		fmt.Fprintf(w, "//\t%s([]string{\n", funcName)
		fmt.Fprintf(w, "//\t    \"item1\",\n")
		fmt.Fprintf(w, "//\t    \"item2\",\n")
		fmt.Fprintf(w, "//\t})\n")
	} else if field.Type.ElementType.Kind == "message" {
		fmt.Fprintf(w, "//\t%s(%s{\n", funcName, sliceType)
		fmt.Fprintf(w, "//\t    {...},\n")
		fmt.Fprintf(w, "//\t    {...},\n")
		fmt.Fprintf(w, "//\t})\n")
	} else {
		fmt.Fprintf(w, "//\t%s(items)\n", funcName)
	}

	// Function signature - accept slice of elements
	fmt.Fprintf(w, "func %s(items %s) %s {\n", funcName, sliceType, optionTypeName)
	fmt.Fprintf(w, "\treturn func(c *%s) {\n", config.Name)

	// Append all items using spread operator
	fmt.Fprintf(w, "\t\tc.%s = append(c.%s, items...)\n", field.Name, field.Name)

	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// getOptionTypeName returns the option type name for a config
func (c *genContext) getOptionTypeName(config *TaskConfigSchema) string {
	// For SDK resources: "AgentSpec" -> "AgentOption"
	if strings.HasSuffix(config.Name, "Spec") {
		name := strings.TrimSuffix(config.Name, "Spec")
		return name + "Option"
	}
	
	// For task configs: "HttpCallTaskConfig" -> "HttpCallOption"
	name := strings.TrimSuffix(config.Name, "TaskConfig")
	return name + "Option"
}

// getBuilderName returns the builder function name for a config
func (c *genContext) getBuilderName(config *TaskConfigSchema) string {
	// "HttpCallTaskConfig" -> "HttpCall"
	return strings.TrimSuffix(config.Name, "TaskConfig")
}

// getTaskKindSuffix returns the TaskKind enum suffix
func (c *genContext) getTaskKindSuffix(config *TaskConfigSchema) string {
	// "HTTP_CALL" -> "HttpCall"
	if config.Kind == "" {
		return strings.TrimSuffix(config.Name, "TaskConfig")
	}
	return titleCase(config.Kind)
}

// singularize converts plural field names to singular form for option functions.
// Examples: "Headers" -> "Header", "Skills" -> "Skill", "Environments" -> "Environment"
func (c *genContext) singularize(plural string) string {
	// Handle common irregular plurals
	irregulars := map[string]string{
		"Children": "Child",
		"People":   "Person",
		"Men":      "Man",
		"Women":    "Woman",
	}

	if singular, ok := irregulars[plural]; ok {
		return singular
	}

	// Simple rule: remove trailing 's' for most cases
	if strings.HasSuffix(plural, "ies") {
		// "Entries" -> "Entry"
		return plural[:len(plural)-3] + "y"
	}
	if strings.HasSuffix(plural, "ses") {
		// "Addresses" -> "Address"
		return plural[:len(plural)-2]
	}
	if strings.HasSuffix(plural, "s") && !strings.HasSuffix(plural, "ss") {
		// "Headers" -> "Header", but not "Address" -> "Addres"
		return plural[:len(plural)-1]
	}

	// If no rule matches, return as-is (might already be singular)
	return plural
}

// pluralize ensures consistent plural form for bulk option functions.
// Examples: "Header" -> "Headers", "Skill" -> "Skills"
func (c *genContext) pluralize(singular string) string {
	// Handle common irregular plurals
	irregulars := map[string]string{
		"Child":  "Children",
		"Person": "People",
		"Man":    "Men",
		"Woman":  "Women",
	}

	if plural, ok := irregulars[singular]; ok {
		return plural
	}

	// Simple rule: add 's' for most cases
	if strings.HasSuffix(singular, "y") && len(singular) > 1 {
		// "Entry" -> "Entries" (if preceded by consonant)
		prevChar := singular[len(singular)-2]
		if prevChar != 'a' && prevChar != 'e' && prevChar != 'i' && prevChar != 'o' && prevChar != 'u' {
			return singular[:len(singular)-1] + "ies"
		}
	}
	if strings.HasSuffix(singular, "s") || strings.HasSuffix(singular, "x") ||
		strings.HasSuffix(singular, "z") || strings.HasSuffix(singular, "ch") ||
		strings.HasSuffix(singular, "sh") {
		// "Address" -> "Addresses"
		return singular + "es"
	}

	// Default: add 's'
	return singular + "s"
}

// needsCoercion determines if a value type needs coerceToString() conversion.
// Returns true for string types (which support expressions), false for structured types.
func (c *genContext) needsCoercion(typeSpec *TypeSpec) bool {
	if typeSpec == nil {
		return false
	}

	switch typeSpec.Kind {
	case "string":
		return true
	case "map":
		// For maps, check if value type is string
		if typeSpec.ValueType != nil && typeSpec.ValueType.Kind == "string" {
			return true
		}
		return false
	default:
		return false
	}
}

// ============================================================================
// Type Conversion
// ============================================================================

// goType converts a TypeSpec to a Go type string
func (c *genContext) goType(typeSpec TypeSpec) string {
	switch typeSpec.Kind {
	case "string":
		return "string"
	case "int32":
		return "int32"
	case "int64":
		return "int64"
	case "bool":
		return "bool"
	case "float":
		return "float32"
	case "double":
		return "float64"
	case "bytes":
		return "[]byte"

	case "map":
		keyType := c.goType(*typeSpec.KeyType)
		valueType := c.goType(*typeSpec.ValueType)
		return fmt.Sprintf("map[%s]%s", keyType, valueType)

	case "array":
		elementType := c.goType(*typeSpec.ElementType)
		return fmt.Sprintf("[]%s", elementType)

	case "message":
		// Pointer for proto compatibility
		return "*" + typeSpec.MessageType

	case "struct":
		// google.protobuf.Struct → map[string]interface{}
		return "map[string]interface{}"

	default:
		panic(fmt.Sprintf("unknown type kind: %s", typeSpec.Kind))
	}
}

// paramName converts a field name to a parameter name (lowercase first letter)
func (c *genContext) paramName(fieldName string) string {
	if fieldName == "" {
		return ""
	}
	return strings.ToLower(fieldName[:1]) + fieldName[1:]
}

// writeComment writes a multi-line comment
func (c *genContext) writeComment(w *bytes.Buffer, comment string) {
	lines := strings.Split(comment, "\n")
	for _, line := range lines {
		if line == "" {
			fmt.Fprintf(w, "//\n")
		} else {
			fmt.Fprintf(w, "// %s\n", line)
		}
	}
}

// writeFieldComment writes a single-line field comment
func (c *genContext) writeFieldComment(w *bytes.Buffer, comment string) {
	// Remove newlines for field comments
	comment = strings.ReplaceAll(comment, "\n", " ")
	fmt.Fprintf(w, "\t// %s\n", comment)
}

// titleCase converts a string to TitleCase (e.g., "HTTP_CALL" -> "HttpCall")
func titleCase(s string) string {
	parts := strings.Split(s, "_")
	for i, part := range parts {
		if len(part) > 0 {
			parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
	}
	return strings.Join(parts, "")
}

// toSnakeCase converts CamelCase to snake_case
// sanitizeDescription sanitizes a description string for use in Go comments
// by replacing newlines with spaces and collapsing multiple spaces
func sanitizeDescription(desc string) string {
	// Replace newlines and carriage returns with spaces
	desc = strings.ReplaceAll(desc, "\n", " ")
	desc = strings.ReplaceAll(desc, "\r", " ")
	
	// Collapse multiple spaces into one
	for strings.Contains(desc, "  ") {
		desc = strings.ReplaceAll(desc, "  ", " ")
	}
	
	// Trim leading and trailing whitespace
	return strings.TrimSpace(desc)
}

func toSnakeCase(s string) string {
	var result []rune
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result = append(result, '_')
		}
		result = append(result, r)
	}
	return strings.ToLower(string(result))
}

// ============================================================================
// Main
// ============================================================================

func main() {
	schemaDir := flag.String("schema-dir", "tools/codegen/schemas", "Directory containing JSON schemas")
	outputDir := flag.String("output-dir", "sdk/go/workflow/gen", "Output directory for generated Go code")
	packageName := flag.String("package", "gen", "Go package name for generated code")
	fileSuffix := flag.String("file-suffix", "", "Suffix for generated files (e.g., '_task', '_spec', or empty)")
	flag.Parse()

	if *schemaDir == "" || *outputDir == "" {
		fmt.Println("Usage: generator --schema-dir <dir> --output-dir <dir> --package <name>")
		os.Exit(1)
	}

	fmt.Printf("Generating Go code from schemas in %s\n", *schemaDir)
	fmt.Printf("Output directory: %s\n", *outputDir)
	fmt.Printf("Package name: %s\n", *packageName)

	// Create generator
	gen, err := NewGenerator(*schemaDir, *outputDir, *packageName, *fileSuffix)
	if err != nil {
		fmt.Printf("Error creating generator: %v\n", err)
		os.Exit(1)
	}

	// Generate code
	if err := gen.Generate(); err != nil {
		fmt.Printf("Error generating code: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\n✅ Code generation complete!")
}
